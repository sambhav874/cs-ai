from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any, Tuple
from pymongo import MongoClient, ReturnDocument
from bson import ObjectId
import logging
from enum import Enum

logger = logging.getLogger(__name__)

class JobStatus(str, Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class JobManager:
    def __init__(self, mongo_uri: str, db_name: str = "contract_analysis_db"):
        self.client = MongoClient(mongo_uri)
        self.db = self.client[db_name]
        self.jobs = self.db.jobs
        self.contracts = self.db.contracts

    def create_job(
        self,
        job_type: str,
        contract_id: str,
        user_id: str,
        status: str = JobStatus.PENDING,
        metadata: Optional[dict] = None
    ) -> str:
        now = datetime.utcnow()
        job_id = f"job_{now.timestamp()}_{contract_id}"
        
        job_data = {
            "job_id": job_id,
            "job_type": job_type,
            "contract_id": ObjectId(contract_id),
            "user_id": ObjectId(user_id),
            "status": status,
            "message": f"{job_type} job created",
            "created_at": now,
            "updated_at": now,
            "error": None,
            "metadata": metadata or {},
            "progress": 0,
            "current_step": "initializing"
        }

        self.jobs.insert_one(job_data)
        self.contracts.update_one(
            {"_id": ObjectId(contract_id)},
            {"$set": {"processing_status": f"{job_type}_{status}"}}
        )
        
        return job_id

    def update_job_status(
        self,
        job_id: str,
        status: str,
        error: Optional[str] = None,
        message: Optional[str] = None,
        progress: Optional[float] = None,
        current_step: Optional[str] = None
    ) -> bool:
        update_data = {
            "status": status,
            "updated_at": datetime.utcnow()
        }

        if error:
            update_data["error"] = error
            update_data["message"] = f"Job failed: {error}"
        elif message:
            update_data["message"] = message
        elif status == JobStatus.COMPLETED:
            update_data["message"] = "Job completed successfully"
            
        if progress is not None:
            update_data["progress"] = progress
            
        if current_step:
            update_data["current_step"] = current_step

        job = self.jobs.find_one_and_update(
            {"job_id": job_id},
            {"$set": update_data},
            return_document=ReturnDocument.AFTER
        )

        if job:
            contract_update = {
                "processing_status": f"{job['job_type']}_{job['status']}",
                "last_updated": datetime.utcnow()
            }
            
            if job["status"] == JobStatus.COMPLETED and job["job_type"] == "processing":
                contract_update["status"] = "Ready to Edit"
            
            if job["status"] == JobStatus.COMPLETED:
                contract_update[f"{job['job_type']}_completed_at"] = datetime.utcnow()
            elif job["status"] == JobStatus.FAILED:
                contract_update[f"{job['job_type']}_failed_at"] = datetime.utcnow()

            self.contracts.update_one(
                {"_id": job["contract_id"]},
                {"$set": contract_update}
            )
            return True
        return False

    def get_job_status(self, job_id: str) -> Optional[dict]:
        job = self.jobs.find_one({"job_id": job_id})
        if job and "_id" in job:
            job["_id"] = str(job["_id"])
            job["contract_id"] = str(job["contract_id"])
            job["user_id"] = str(job["user_id"])
        return job

    def get_jobs_for_document(self, document_id: str) -> List[dict]:
        jobs = list(self.jobs.find({"contract_id": ObjectId(document_id)})
                   .sort("created_at", -1))
        
        for job in jobs:
            if "_id" in job:
                job["_id"] = str(job["_id"])
            if "contract_id" in job:
                job["contract_id"] = str(job["contract_id"])
            if "user_id" in job:
                job["user_id"] = str(job["user_id"])
        return jobs

    def get_latest_job_snapshot(self, contract_id: str) -> dict:
        """
        Return a compact, JSON-serialisable snapshot of all jobs for a contract.
        Used by the WebSocket poll loop to detect and broadcast changes.

        Returns a dict of {job_id -> {status, progress, current_step, job_type, error}}
        """
        jobs = self.get_jobs_for_document(contract_id)
        return {
            job["job_id"]: {
                "job_id":       job["job_id"],
                "status":       job.get("status"),
                "progress":     job.get("progress", 0),
                "current_step": job.get("current_step"),
                "job_type":     job.get("job_type"),
                "error":        job.get("error"),
                "contract_id":  job.get("contract_id"),
            }
            for job in jobs
        }

    def is_terminal_snapshot(self, snapshot: dict) -> bool:
        """
        Returns True when every job in the snapshot has reached a terminal state
        (COMPLETED or FAILED), meaning no more updates should be expected.
        """
        if not snapshot:
            return False
        terminal = {"COMPLETED", "FAILED"}
        return all(v["status"] in terminal for v in snapshot.values())

    def cleanup_old_jobs(self, days: int = 30) -> int:
        cutoff_date = datetime.utcnow() - timedelta(days=days)
        result = self.jobs.delete_many({"created_at": {"$lt": cutoff_date}})
        logger.info(f"Cleaned up {result.deleted_count} old jobs")
        return result.deleted_count


_job_manager_cache: Dict[Tuple[str, str], JobManager] = {}


def get_job_manager(mongo_uri: str, db_name: str = "contract_analysis_db") -> JobManager:
    """Reuse MongoClient-backed JobManager instances across request dependencies."""
    cache_key = (mongo_uri, db_name)
    manager = _job_manager_cache.get(cache_key)
    if manager is None:
        manager = JobManager(mongo_uri=mongo_uri, db_name=db_name)
        _job_manager_cache[cache_key] = manager
    return manager
