terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 3.23.0" 
    }
  }
}

provider "azurerm" {
  features {}
}

data "azurerm_container_registry" "acr" {
  name                = "ContractLens"
  resource_group_name = "ContractLens-KN-Dev-RG"
}

resource "azurerm_resource_group" "main" {
  name     = "${var.client}-rg"
  location = var.location
}

resource "azurerm_static_web_app" "static" {
  name                = "ContractSense"
  resource_group_name = azurerm_resource_group.main.name
  location            = "westeurope"
}

resource "azurerm_servicebus_namespace" "sb" {
  name                = "${var.client}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Standard"
}

resource "azurerm_storage_account" "blob" {
  name                     = "${var.client}blob"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_service_plan" "appplan" {
  name                = "${var.client}-asp"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  os_type             = "Linux"
  sku_name            = "P1v2"
}

resource "azurerm_app_service" "backend" {
  name                = "${var.client}backend"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  app_service_plan_id = azurerm_service_plan.appplan.id

  site_config {
    linux_fx_version = "DOCKER|${var.acr_login_server}/backend:${var.backend_image_tag}"
    always_on        = true
  }

  identity {
    type = "SystemAssigned"
  }

  app_settings = {
    WEBSITES_ENABLE_APP_SERVICE_STORAGE = "false"
    DOCKER_REGISTRY_SERVER_URL          = "https://${var.acr_login_server}"
  }
}

resource "azurerm_role_assignment" "backend_acr_pull" {
  scope                = data.azurerm_container_registry.acr.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_app_service.backend.identity[0].principal_id
}

resource "azurerm_container_app_environment" "cae" {
  name                = "${var.client}-cae"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }
}

# Container app with secret-based registry authentication and all environment variables
resource "azurerm_container_app" "workers" {
  name                         = "${var.client}-workers"
  container_app_environment_id = azurerm_container_app_environment.cae.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

  # ACR authentication secret
  secret {
    name  = "acr-password"
    value = var.acr_admin_password
  }

  # Secrets for sensitive environment variables
  # Convert underscores to hyphens for secret names (Azure requirement)
  # but keep original environment variable names with underscores
  dynamic "secret" {
    for_each = var.container_env_secrets
    content {
      name  = replace(lower(secret.key), "_", "-")
      value = secret.value
    }
  }

  registry {
    server               = data.azurerm_container_registry.acr.login_server
    username             = var.acr_admin_username
    password_secret_name = "acr-password"
  }

  template {
    min_replicas = 0
    max_replicas = 10

    container {
      name   = "workers-dev"
      image  = "${data.azurerm_container_registry.acr.login_server}/workers-dev:${var.workers_image_tag}"
      cpu    = 0.5
      memory = "1.0Gi"
      
      # Regular environment variables (keep original names with underscores)
      dynamic "env" {
        for_each = var.container_env_vars
        content {
          name  = env.key
          value = env.value
        }
      }

      # Sensitive environment variables from secrets
      # Environment variable names keep underscores, but reference secrets with hyphens
      dynamic "env" {
        for_each = var.container_env_secrets
        content {
          name        = env.key  # Keep original name with underscores
          secret_name = replace(lower(env.key), "_", "-")  # Reference secret with hyphens
        }
      }
    }
  }
}

resource "azurerm_monitor_action_group" "actiongroup" {
  name                = "${var.client}backend"
  resource_group_name = azurerm_resource_group.main.name
  short_name          = substr("act${var.client}", 0, 12)
  email_receiver {
    name                    = "ops"
    email_address           = var.notification_email
    use_common_alert_schema = true
  }
}

resource "azurerm_monitor_activity_log_alert" "activitylog" {
  name                = "${var.client}backend"
  resource_group_name = azurerm_resource_group.main.name
  location            = "westeurope"
  scopes              = [azurerm_app_service.backend.id]
  description         = "Alert for ${var.client} backend admin changes"
  enabled             = true

  criteria {
    category       = "Administrative"
    operation_name = "Microsoft.Web/sites/Write"
  }

  action {
    action_group_id = azurerm_monitor_action_group.actiongroup.id
  }
}