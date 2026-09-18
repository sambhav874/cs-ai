
# variables.tf
variable "client" {
  description = "Client short name"
  type        = string
  default     = "contractsensedev"
}

variable "location" {
  description = "Azure location for all resources"
  type        = string
  default     = "uksouth"
}

variable "acr_name" {
  description = "Azure Container Registry name"
  type        = string
  default     = "contractlens"
}

variable "acr_login_server" {
  description = "Azure Container Registry login server"
  type        = string
  default     = "contractlens.azurecr.io"
}

variable "backend_image_tag" {
  description = "Tag for the backend image"
  type        = string
  default     = "latest"
}

variable "workers_image_tag" {
  description = "Tag for the workers image"
  type        = string
  default     = "latest"
}

variable "notification_email" {
  description = "Notification email for action group alerts"
  type        = string
  default     = "ops@example.com"
}

# ACR admin credentials (for secret-based auth)
variable "acr_admin_username" {
  description = "ACR admin username"
  type        = string
  sensitive   = true
}

variable "acr_admin_password" {
  description = "ACR admin password"
  type        = string
  sensitive   = true
}