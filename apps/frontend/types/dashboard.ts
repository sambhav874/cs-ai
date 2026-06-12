export interface Document {
    _id: string;
    contract_name: string;
    status: string;
    uploaded_at: string;
    upload: { status: string };
    index: { status: string };
    summarize: { status: string };
    process: { status: string };
  }
  
  export interface DocumentWithProgress extends Document {
    isProcessing: boolean;
    progress: number;
    uploadStatus: string;
    indexStatus: string;
    summarizeStatus: string;
    processStatus: string;
  }
  
  export interface StatusBadgeProps {
    status: string;
    processingText: string;
  }
  