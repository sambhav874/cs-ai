import csv
from pathlib import Path
from typing import Dict, Any

def json_to_csv(json_data: Dict[str, Any], csv_file_path: Path) -> None:
    """
    Converts JSON data to CSV and saves it to the specified file path.
    
    Args:
        json_data (Dict[str, Any]): The JSON data to convert.
        csv_file_path (Path): The path to save the CSV file.
    """
    # Flatten the JSON data (if nested)
    def flatten_dict(d: Dict[str, Any], parent_key: str = '', sep: str = '_') -> Dict[str, Any]:
        items = []
        for k, v in d.items():
            new_key = f"{parent_key}{sep}{k}" if parent_key else k
            if isinstance(v, dict):
                items.extend(flatten_dict(v, new_key, sep=sep).items())
            elif isinstance(v, list):
                for i, item in enumerate(v):
                    if isinstance(item, dict):
                        items.extend(flatten_dict(item, f"{new_key}_{i}", sep=sep).items())
                    else:
                        items.append((f"{new_key}_{i}", item))
            else:
                items.append((new_key, v))
        return dict(items)

    # Flatten the JSON data
    flat_data = flatten_dict(json_data)

    # Write to CSV
    with open(csv_file_path, mode='w', newline='', encoding='utf-8') as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow(flat_data.keys())  # Write headers
        writer.writerow(flat_data.values())  # Write data