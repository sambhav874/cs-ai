// AnimatedUploadIcon.tsx
import { Upload } from "lucide-react"

export const AnimatedUploadIcon = () => {
  return (
    <div className="relative h-4 w-4 font-GullyVar">
      <Upload 
        className="h-4 w-4 absolute transition-all duration-300 ease-in-out group-hover:-translate-y-2 group-hover:opacity-0"
      />
      <Upload 
        className="h-4 w-4 absolute transition-all duration-300 ease-in-out translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100"
      />
    </div>
  )
}