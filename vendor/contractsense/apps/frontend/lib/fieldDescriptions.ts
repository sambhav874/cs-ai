import fieldDescription  from "./fieldDescription"

export function getFieldDescription(key: string): string {
  return fieldDescription[key] || "No description available."
}

