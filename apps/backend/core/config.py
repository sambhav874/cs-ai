from pydantic_settings import BaseSettings
from pydantic import Field , validator
from typing import Optional
import os

def get_env_file():
    # If the TESTING environment variable is set to 'true', load the test config.
    if os.getenv("TESTING") == 'true':
        return ".env.test"
    return ".env"


class Settings(BaseSettings):
    # Hugging Face and Groq Credentials
    huggingface_token: str = Field(..., env="HUGGINGFACE_TOKEN")
    groq_api_key: str = Field(..., env="GROQ_API_KEY")
    groq_strict_mode: bool = Field(default=False, env="GROQ_STRICT_MODE")

    # API Configuration
    api_host: str = Field(default="0.0.0.0", env="API_HOST")
    api_port: int = Field(default=8000, env="API_PORT")
    api_timeout: int = Field(default=30, env="API_TIMEOUT")

    
    # Model Configuration
    model_name: str = Field(default="meta-llama/Llama-3.2-1B", env="MODEL_NAME")
    use_gpu: bool = Field(default=False, env="USE_GPU")
    max_tokens: int = Field(default=2048, env="MAX_TOKENS")
    temperature: float = Field(default=0.1, env="TEMPERATURE")
    top_p: float = Field(default=0.95, env="TOP_P")
    frequency_penalty: float = Field(default=1.15, env="FREQUENCY_PENALTY")
    n: int = Field(default=1, env="N")

    # Hugging Face Embeddings Configuration
    embeddings_model_name: str = Field(default="intfloat/e5-large-v2", env="EMBEDDINGS_MODEL_NAME")


    # Other Configuration
    thread_pool_workers: int = Field(default=4, env="THREAD_POOL_WORKERS")
    chunk_size: int = Field(default=4000, env="CHUNK_SIZE")
    chunk_overlap: int = Field(default=200, env="CHUNK_OVERLAP")
    retriever_candidate_k: int = Field(default=32, env="RETRIEVER_CANDIDATE_K")
    retriever_final_k: int = Field(default=14, env="RETRIEVER_FINAL_K")
    max_segments_in_prompt: int = Field(default=18, env="MAX_SEGMENTS_IN_PROMPT")
    retriever_context_char_budget: int = Field(default=12000, env="RETRIEVER_CONTEXT_CHAR_BUDGET")
    retriever_segment_excerpt_chars: int = Field(default=1200, env="RETRIEVER_SEGMENT_EXCERPT_CHARS")
    chunk_schema_version: int = Field(default=2, env="CHUNK_SCHEMA_VERSION")
    legal_meso_min_chars: int = Field(default=1200, env="LEGAL_MESO_MIN_CHARS")
    legal_meso_max_chars: int = Field(default=3000, env="LEGAL_MESO_MAX_CHARS")
    legal_macro_max_chars: int = Field(default=2600, env="LEGAL_MACRO_MAX_CHARS")
    legal_micro_context_chars: int = Field(default=420, env="LEGAL_MICRO_CONTEXT_CHARS")

    # Environment
    app_env: str = Field(default="development", env="APP_ENV")
    
    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


    # Security Configuration
    allowed_origins: str = Field(default="http://localhost:4200", env="ALLOWED_ORIGINS")
    

    support_email_address: str = Field(..., env="SUPPORT_EMAIL_ADDRESS")
    
    # Database Configuration
    mongodb_uri: str = Field(default="", env="MONGODB_URI")
    testing: bool = Field(default=False, env="TESTING")
     
    # Azure Communication Services Configuration
    azure_communication_connection_string: str = Field(..., env="AZURE_COMMUNICATION_CONNECTION_STRING")
    azure_sender_address: str = Field(..., env="AZURE_SENDER_ADDRESS")

    marker_api_key: str = Field(default=None, env="MARKER_API_KEY")
    marker_api_url: str = Field(default = "https://www.datalab.to/api/v1/marker", env= "MARKER_API_URL")
    domain: str = Field(default="http://localhost:4200", env="DOMAIN")
    secret_key: str = Field(..., env="SECRET_KEY") 
    algorithm: str = Field(default="HS256", env="ALGORITHM")
    access_token_expire_minutes: int = Field(default=30, env="ACCESS_TOKEN_EXPIRE_MINUTES")
    
    
    openai_embed_dim: int = Field(default=1536, env="OPENAI_EMBED_DIM") 
    pinecone_api_key: str = Field(default="", env="PINECONE_API_KEY")
    pinecone_index_name: str = Field(default="", env="PINECONE_INDEX_NAME")
    openai_embedding_model: str = Field(default="text-embedding-3-small", env="OPENAI_EMBEDDING_MODEL")
    voyageai_api_key: str = Field(default="", env="VOYAGEAI_API_KEY")
    voyageai_model_name: str = Field(default="voyage-law-2", env="VOYAGEAI_MODEL_NAME")

    # MongoDB-hosted Voyage AI (Atlas Model API Keys)
    mongodb_voyage_api_key: str = Field(default="", env="MONGODB_VOYAGE_API_KEY")
    mongodb_voyage_model_name: str = Field(default="voyage-3-large", env="MONGODB_VOYAGE_MODEL_NAME")
    mongodb_voyage_api_base: str = Field(default="https://ai.mongodb.com/v1", env="MONGODB_VOYAGE_API_BASE")

    # MongoDB Atlas Vector Search
    use_mongodb_vector: bool = Field(default=True, env="USE_MONGODB_VECTOR")
    mongodb_db_name: str = Field(default="contract_analysis", env="MONGODB_DB_NAME")
    mongodb_collection_name: str = Field(default="contract_vectors", env="MONGODB_COLLECTION_NAME")
    mongodb_vector_index_name: str = Field(default="vector_index", env="MONGODB_VECTOR_INDEX_NAME")

    anthropic_api_key: str = Field(default="", env="ANTHROPIC_API_KEY")
    anthropic_model_name: Optional[str] = Field(default="claude-haiku-4-5", env="ANTHROPIC_MODEL_NAME")
    claude_strict_mode: bool = Field(default=False, env="CLAUDE_STRICT_MODE")
    gemini_api_key: str = Field(default="", env="GEMINI_API_KEY")
    gemini_model_name: Optional[str] = Field(default="gemini-2.0-flash", env="GEMINI_MODEL_NAME")
    cleanup_pinecone_namespace: bool = Field(default=True, env="CLEANUP_PINECONE_NAMESPACE")
    openai_api_key: Optional[str] = Field(default="", env="OPENAI_API_KEY")
    openai_model_name: Optional[str] = Field(default="gpt-4-turbo-preview", env="OPENAI_MODEL_NAME")
    claude_model_name: Optional[str] = Field(default="claude-haiku-4-5", env="CLAUDE_MODEL_NAME")

    # Celery & Redis Configuration
    celery_broker_url: str = Field(default="amqp://guest:guest@localhost:5672//", env="CELERY_BROKER_URL")

    # Azure Service Bus Configuration
    service_bus_sas_policy_name: Optional[str] = Field(default=None, env="SERVICE_BUS_SAS_POLICY_NAME")
    service_bus_sas_key: Optional[str] = Field(default=None, env="SERVICE_BUS_SAS_KEY")
    service_bus_namespace: Optional[str] = Field(default=None, env="SERVICE_BUS_NAMESPACE")
    azure_service_bus_connection_string: Optional[str] = Field(default=None, env="AZURE_SERVICE_BUS_CONNECTION_STRING")


    @validator('mongodb_uri')
    def strip_mongodb_uri(cls, v):
        return v.strip() if v else ""
    
    @validator('access_token_expire_minutes')
    def token_expiry_reasonable(cls, v):
        if v > 1440:
            raise ValueError("ACCESS_TOKEN_EXPIRE_MINUTES should not exceed 24 hours (1440).")
        return v

    class Config:
        # Use our helper function to dynamically choose the file to load.
        # Pydantic is smart enough to call this function during initialization.
        env_file = get_env_file()
        env_file_encoding = "utf-8"
        extra = "ignore"  # Allow extra environment variables to be ignored instead of crashing

settings = Settings()
