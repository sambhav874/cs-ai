export function formatDate(dateString: string): string {
    if (!dateString) return "N/A"
  
    // Check if the date is in DD/MM/YYYY format
    const ddmmyyyyFormat = /^\d{2}\/\d{2}\/\d{4}$/
    if (ddmmyyyyFormat.test(dateString)) {
      const [day, month, year] = dateString.split("/")
      return new Date(`${year}-${month}-${day}`).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    }
  
    // If not in DD/MM/YYYY format, assume it's a standard date string
    const date = new Date(dateString)
    return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
  }
  
  