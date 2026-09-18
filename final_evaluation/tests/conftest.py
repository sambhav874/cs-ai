import os
import pytest
from dotenv import load_dotenv
from langsmith import traceable, Client

conftest_dir = os.path.dirname(os.path.abspath(__file__))
backend_env_path = os.path.join(conftest_dir, "../../apps/intelligence/.env")
load_dotenv(dotenv_path=backend_env_path)

# Use the LangSmith client natively instead of mutating os.environ globally.
# This client will be used by tests to log feedback scores directly to traces.
ls_client = Client()
EVAL_PROJECT = "contractsense"

def pytest_addoption(parser):
    parser.addoption(
        "--contract-count",
        action="store",
        default=3,
        type=int,
        help="Number of live evaluation contract cases to run in the benchmark test suite",
    )
    parser.addoption(
        "--dataset",
        action="store",
        default="all",
        choices=["all", "smoke", "cuad", "acord", "kpi"],
        help="Dataset suite to evaluate: all, smoke, cuad, acord, or kpi",
    )

@traceable(project_name=EVAL_PROJECT, name="AgentEvalExecution")
def run_agent_traceable(runner, state):
    """
    A traceable wrapper around the agent runner. 
    This natively integrates with LangSmith without relying on global ENV hacks.
    """
    return runner.run(state)

def pytest_configure(config):
    config.addinivalue_line("markers", "sanity: Mark test as part of the sanity evaluation family")
    config.addinivalue_line("markers", "functional: Mark test as part of the functional live-agent test family")
    config.addinivalue_line("markers", "non_functional: Mark test as part of the non-functional benchmark test family")
    config.addinivalue_line("markers", "operational: Mark test as part of the operational runner harness family")


@pytest.fixture(scope="session")
def langsmith_client():
    return ls_client


@pytest.fixture(scope="session")
def eval_project():
    return EVAL_PROJECT

