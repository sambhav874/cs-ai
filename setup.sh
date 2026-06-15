#!/bin/bash
set -e  # Exit on error

# Update and install system dependencies
echo "Updating system and installing dependencies..."
sudo apt-get update
sudo apt-get install -y \
    curl \
    git \
    build-essential \
    libssl-dev \
    libffi-dev \
    libgl1 \
    libglib2.0-0 \
    python3-dev \
    python3-venv \
    python3-pip

# Install Node.js (for Next.js frontend)
echo "Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify Node.js and npm installation
node -v
npm -v

# Install Python (if not already installed)
echo "Ensuring Python 3.11 is installed..."
sudo apt-get install -y software-properties-common
sudo add-apt-repository -y ppa:deadsnakes/ppa
sudo apt-get update
sudo apt-get install -y python3.11 python3.11-venv python3.11-dev

# Set Python 3.11 as the default
sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 2
sudo update-alternatives --config python3

#install pycurl
echo "Installing pycurl..."
sudo apt-get install -y python3-pycurl

# Install Poetry
echo "Installing Poetry..."
curl -sSL https://install.python-poetry.org | python3 -

# Add Poetry to PATH
echo 'export PATH="$HOME/kunal/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Verify Poetry installation
poetry --version

# Install Docker
echo "Installing Docker..."
curl -fsSL https://get.docker.com | sudo sh

# Add the current user to the Docker group
sudo usermod -aG docker $USER

# Install Docker Compose
echo "Installing Docker Compose..."
sudo curl -L "https://github.com/docker/compose/releases/download/v2.23.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify Docker and Docker Compose installation
docker --version
docker-compose --version

# Install GPU dependencies (optional)
read -p "Do you want to install GPU dependencies? (y/n): " INSTALL_GPU
if [[ "$INSTALL_GPU" == "y" || "$INSTALL_GPU" == "Y" ]]; then
    echo "Installing GPU dependencies..."
    sudo apt-get update
    sudo apt-get install -y \
        nvidia-cuda-toolkit \
        nvidia-driver-535  # Adjust the driver version as needed
    echo "GPU dependencies installed."
else
    echo "Skipping GPU dependencies."
fi

# Clone the project repository (replace with your actual repo URL)
echo "Cloning the project repository..."
git clone https://github.com/sambhav874/extractor.git
cd extractor

# Create shared directories
echo "Creating shared directory..."
mkdir -p shared
sudo chmod -R 755 shared

# Install frontend dependencies
echo "Installing frontend dependencies..."
cd apps/frontend
npm install
cd ../..

# Install backend dependencies using Poetry
echo "Installing backend dependencies..."
cd apps/backend
poetry install
cd ../..

echo "Setup complete! Your VM is ready to run the project."
echo "To start the project, run: docker-compose up --build"
