#!/bin/bash

# Current settings
CURRENT_DATE="2025-02-09 15:09:34"


# Text colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting setup script...${NC}"

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check OS
check_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macOS"
    elif [[ -f /etc/os-release ]]; then
        source /etc/os-release
        echo "$ID"
    else
        echo "unknown"
    fi
}

# Install prerequisites based on OS
install_prerequisites() {
    local os=$(check_os)
    echo -e "${YELLOW}Detected OS: $os${NC}"

    case $os in
        "macos")
            # Install Homebrew if not installed
            if ! command_exists brew; then
                echo -e "${YELLOW}Installing Homebrew...${NC}"
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            fi
            
            # Install prerequisites using Homebrew
            echo -e "${YELLOW}Installing prerequisites using Homebrew...${NC}"
            brew install docker
            brew install docker-compose
            ;;
            
        "ubuntu"|"debian")
            # Update package list
            sudo apt-get update
            
            # Install prerequisites
            sudo apt-get install -y docker.io docker-compose
            ;;
            
        "fedora"|"rhel")
            # Install prerequisites
            sudo dnf install -y docker docker-compose
            ;;
            
        *)
            echo -e "${RED}Unsupported operating system${NC}"
            exit 1
            ;;
    esac
}

# Setup Docker
setup_docker() {
    if [[ "$(check_os)" == "macos" ]]; then
        echo -e "${YELLOW}On macOS, please ensure Docker Desktop is running.${NC}"
    else
        echo -e "${YELLOW}Starting Docker service...${NC}"
        sudo systemctl start docker || true
        sudo systemctl enable docker || true
    fi
}

# Create required directories
create_directories() {
    echo -e "${YELLOW}Creating required directories...${NC}"
    mkdir -p shared/{contracts,cleaned_contracts,final_extracted_data,contract_summaries,dynamic_questions,model_cache}
}

# Check for Node.js and npm
setup_node() {
    if ! command_exists node; then
        echo -e "${YELLOW}Installing Node.js...${NC}"
        case $(check_os) in
            "macos")
                brew install node
                ;;
            "ubuntu"|"debian")
                curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
                sudo apt-get install -y nodejs
                ;;
            "fedora"|"rhel")
                curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
                sudo dnf install -y nodejs
                ;;
        esac
    fi
}

# Main setup
main() {
    echo -e "${GREEN}Starting installation at: $CURRENT_DATE${NC}"
    echo -e "${GREEN}User: $CURRENT_USER${NC}"
    
    # Install prerequisites
    install_prerequisites
    
    # Setup Docker
    setup_docker
    
    # Setup Node.js
    setup_node
    
    # Create directories
    create_directories
    
    # Install project dependencies
    echo -e "${YELLOW}Installing project dependencies...${NC}"
    npm install
    
    echo -e "${GREEN}Setup completed successfully!${NC}"
    
    # Print usage instructions
    echo -e "\n${GREEN}Usage Instructions:${NC}"
    echo -e "${YELLOW}1. Individual container builds:${NC}"
    echo "docker build -f apps/backend/Containerfile -t backend:latest ."
    echo "docker build -f apps/frontend/Containerfile --target development -t frontend:dev ."
    
    echo -e "\n${YELLOW}2. Using docker-compose:${NC}"
    echo "# For backend:"
    echo "docker compose -f docker/docker-compose.backend.yml up --build"
    echo "# For frontend development:"
    echo "docker compose -f docker/docker-compose.frontend.dev.yml up --build"
    echo "# For frontend production:"
    echo "docker compose -f docker/docker-compose.frontend.yml up --build"
    
    echo -e "\n${YELLOW}3. To run both services:${NC}"
    echo "docker compose -f docker/docker-compose.backend.yml -f docker/docker-compose.frontend.dev.yml up --build"
    
    echo -e "\n${YELLOW}4. To run local dev servers directly:${NC}"
    echo "npm run dev:frontend"
    echo "npm run dev:backend"
}

# Run main function
main