import logging
from pathlib import Path

LOGGER = logging.getLogger(__name__)
MARKER_AVAILABLE = False

try:
    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict
    from marker.config.parser import ConfigParser
    from marker.output import text_from_rendered
    MARKER_AVAILABLE = True
except ImportError:
    LOGGER.warning("marker-pdf library not installed. Local marker processing will not be available.")

def get_marker_models():
    """Cache the marker models to avoid reloading them on every request."""
    if not MARKER_AVAILABLE:
        return None
    return create_model_dict()

class MarkerProcessor:
    def __init__(self):
        """Initialize the MarkerProcessor with cached models."""
        if not MARKER_AVAILABLE:
            raise ImportError("marker-pdf library is not installed. Please install it to use local marker processing.")
        self.models = get_marker_models()
    
    def process_document(self, file_path: str, output_dir: str) -> str:
        """
        Process a document using the Marker library.

        Args:
            file_path (str): Path to the input file.
            output_dir (str): Directory to save the processed output.

        Returns:
            str: The processed content of the document.
        """
        if not MARKER_AVAILABLE:
            raise ImportError("marker-pdf library is not installed. Please install it to use local marker processing.")
            
        config_dict = {
            "output_dir": output_dir,
            "output_format": "markdown",
            "force_ocr": False,
            "disable_multiprocessing": True,
            "use_fast": True,
            "paginate_output": False
        }
        
        config_parser = ConfigParser(config_dict)
        converter = PdfConverter(
            config=config_parser.generate_config_dict(),
            artifact_dict=self.models,
            processor_list=config_parser.get_processors(),
            renderer=config_parser.get_renderer()
        )
        
        try:
            rendered = converter(file_path)
            content, _, _ = text_from_rendered(rendered)
            return content
        except Exception as e:
            LOGGER.exception(f"Error processing document {file_path}: {e}")
            raise