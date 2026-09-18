
# outputs.tf
output "static_web_app_url" {
  value = azurerm_static_web_app.static.default_host_name
}

output "backend_app_service_url" {
  value = azurerm_app_service.backend.default_site_hostname
}

output "backend_principal_id" {
  description = "Principal ID of the backend App Service's managed identity"
  value       = azurerm_app_service.backend.identity[0].principal_id
}

output "container_app_workers_name" {
  value = azurerm_container_app.workers.name
}

output "servicebus_namespace_name" {
  value = azurerm_servicebus_namespace.sb.name
}

output "storage_account_name" {
  value = azurerm_storage_account.blob.name
}

output "action_group_id" {
  value = azurerm_monitor_action_group.actiongroup.id
}