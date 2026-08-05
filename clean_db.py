import sys
import os

sys.path.append(os.path.join(os.getcwd(), 'apps/backend'))

import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from config import settings

async def main():
    client = AsyncIOMotorClient(settings.MONGODB_URI)
    db = client[settings.MONGODB_DB_NAME]
    
    # Delete old ones
    await db["contract_kpi_integration_profiles"].delete_many({"source_type": {"$in": ["csv", "json"]}})
    await db["contract_kpi_source_configs"].delete_many({"source_type": {"$in": ["csv", "json"]}})
    
    # Let's also print what we have now
    profiles = await db["contract_kpi_integration_profiles"].find().to_list(100)
    print("PROFILES:", [(p.get("display_name"), p.get("source_type")) for p in profiles])
    
    configs = await db["contract_kpi_source_configs"].find().to_list(100)
    print("CONFIGS:", [(c.get("display_name"), c.get("source_type")) for c in configs])

asyncio.run(main())
