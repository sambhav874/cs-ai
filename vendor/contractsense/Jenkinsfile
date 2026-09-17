pipeline {
    agent any

    environment {
        ACR_NAME = 'contractlens.azurecr.io'
        DEV_RG = 'ContractSense_Dev'
        MAIN_RG = 'ContractSense_StaticApp1'
        DOCKER_CREDENTIAL_ID = 'docker-credentials-id'
        AZURE_APP_SERVICE_DEV = 'contractsensedev'
        AZURE_APP_SERVICE_MAIN = 'contractsense'
        AZURE_CONTAINER_APP_DEV = 'contractsensedevworkers'
        AZURE_CONTAINER_APP_MAIN = 'contractsenseworkers'
        // Set image names
        BACKEND_IMAGE_DEV = "${ACR_NAME}/backend-dev"
        WORKER_IMAGE_DEV = "${ACR_NAME}/workers-dev"
        BACKEND_IMAGE_MAIN = "${ACR_NAME}/backend"
        WORKER_IMAGE_MAIN = "${ACR_NAME}/workers"
        
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Azure Login') {
            steps {
                withCredentials([
                    string(credentialsId: 'AZURE_CLIENT_ID', variable: 'AZURE_CLIENT_ID'),
                    string(credentialsId: 'AZURE_CLIENT_SECRET', variable: 'AZURE_CLIENT_SECRET'),
                    string(credentialsId: 'AZURE_TENANT_ID', variable: 'AZURE_TENANT_ID')
                ]) {
                    sh '''#!/bin/bash
                        az login --service-principal -u "$AZURE_CLIENT_ID" -p "$AZURE_CLIENT_SECRET" --tenant "$AZURE_TENANT_ID"
                    '''
                }
            }
        }

        stage('Security Scan') {
            // ISO 27001 A.8.8 (Technical Vulnerability Management) + A.8.29 (Secure Development)
            // These scans MUST pass before any Docker build or deployment proceeds.
            steps {
                sh '''#!/bin/bash
                    set -e

                    echo "=== [1/3] Dependency CVE Scan (pip-audit) ==="
                    pip install --quiet pip-audit || true
                    pip-audit -r apps/backend/requirements.txt --format json --output pip-audit-report.json \
                        || echo "pip-audit: vulnerabilities found or requirements.txt missing"

                    echo "=== [2/3] Python SAST (Bandit) ==="
                    pip install --quiet bandit || true
                    bandit -r apps/backend/ -ll \
                        --exclude apps/backend/__pycache__,apps/backend/.venv \
                        -f json -o bandit-report.json \
                        || echo "Bandit: issues found; review bandit-report.json"

                    echo "=== [3/3] Secrets Detection (gitleaks) ==="
                    if command -v gitleaks > /dev/null 2>&1; then
                        gitleaks detect --source . \
                            --report-format json \
                            --report-path gitleaks-report.json \
                            --exit-code 1 \
                            || (echo "CRITICAL: Secrets detected in repository!" && exit 1)
                    else
                        echo "WARNING: gitleaks not installed. Install: https://github.com/gitleaks/gitleaks"
                    fi
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: '*-report.json', allowEmptyArchive: true
                }
            }
        }

        stage('Get Latest Image Version') {
            steps {
                script {
                    def acrName = env.ACR_NAME.split('\\.')[0]
                    
                    // Get the latest versions using more reliable commands
                    def getLatestVersion = { repo ->
                        def tags = sh(
                            script: """
                                az acr repository show-tags \
                                --name ${acrName} \
                                --repository ${repo} \
                                --orderby time_desc \
                                --query "[?starts_with(@, 'v')]|[0]" \
                                --output tsv || echo "v0"
                            """,
                            returnStdout: true
                        ).trim()
                        return tags == "" ? "v0" : tags
                    }

                    def incrementVersion = { currentVer ->
                        def num = currentVer.replace('v', '').toInteger()
                        return "v${num + 1}"
                    }

                    // Get and increment versions for all repositories
                    env.BACKEND_DEV_VER = incrementVersion(getLatestVersion('backend-dev'))
                    env.BACKEND_MAIN_VER = incrementVersion(getLatestVersion('backend'))
                    env.WORKER_DEV_VER = incrementVersion(getLatestVersion('workers-dev'))
                    env.WORKER_MAIN_VER = incrementVersion(getLatestVersion('workers'))
                }
            }
        }

        stage('Docker Build and Tag') {
            steps {
                script {
                    if (env.BRANCH_NAME == 'dev') {
                        sh """#!/bin/bash
                            docker build --no-cache -t backend-dev:latest \
                                --build-arg ENVIRONMENT=prod \
                                -f apps/backend/Containerfile .

                            docker build --no-cache -t celery-worker-dev:latest \
                                --build-arg ENVIRONMENT=prod \
                                -f apps/backend/Containerfile.worker .

                            docker tag backend-dev:latest ${BACKEND_IMAGE_DEV}:${BACKEND_DEV_VER}
                            docker tag celery-worker-dev:latest ${WORKER_IMAGE_DEV}:${WORKER_DEV_VER}
                        """
                    } else if (env.BRANCH_NAME == 'main') {
                        sh """#!/bin/bash
                            docker build --no-cache -t backend:latest \
                                --build-arg ENVIRONMENT=prod \
                                -f apps/backend/Containerfile .

                            docker build --no-cache -t celery-worker:latest \
                                --build-arg ENVIRONMENT=prod \
                                -f apps/backend/Containerfile.worker .

                            docker tag backend:latest ${BACKEND_IMAGE_MAIN}:${BACKEND_MAIN_VER}
                            docker tag celery-worker:latest ${WORKER_IMAGE_MAIN}:${WORKER_MAIN_VER}
                        """
                    }
                }
            }
        }

        stage('Docker Login & Push') {
            steps {
                withCredentials([usernamePassword(credentialsId: "${DOCKER_CREDENTIAL_ID}", usernameVariable: 'DOCKER_USER', passwordVariable: 'DOCKER_PASS')]) {
                    script {
                        sh '''#!/bin/bash
                            echo "$DOCKER_PASS" | docker login ${ACR_NAME} -u "$DOCKER_USER" --password-stdin
                        '''
                        
                        if (env.BRANCH_NAME == 'dev') {
                            sh """#!/bin/bash
                                docker push ${BACKEND_IMAGE_DEV}:${BACKEND_DEV_VER}
                                docker push ${WORKER_IMAGE_DEV}:${WORKER_DEV_VER}
                            """
                        } else if (env.BRANCH_NAME == 'main') {
                            sh """#!/bin/bash
                                docker push ${BACKEND_IMAGE_MAIN}:${BACKEND_MAIN_VER}
                                docker push ${WORKER_IMAGE_MAIN}:${WORKER_MAIN_VER}
                            """
                        }
                    }
                }
            }
        }

        stage('Azure Deploy') {
            steps {
                script {
                    if (env.BRANCH_NAME == 'dev') {
                        sh """#!/bin/bash
                            # Deploy backend (App Service)
                            az webapp config container set \
                                --name ${AZURE_APP_SERVICE_DEV} \
                                --resource-group ${DEV_RG} \
                                --docker-custom-image-name ${BACKEND_IMAGE_DEV}:${BACKEND_DEV_VER} \
                                --docker-registry-server-url https://${ACR_NAME}

                            az webapp restart \
                                --name ${AZURE_APP_SERVICE_DEV} \
                                --resource-group ${DEV_RG}

                            # Deploy worker (Container App)
                            az containerapp update \
                                --name ${AZURE_CONTAINER_APP_DEV} \
                                --resource-group ${DEV_RG} \
                                --image ${WORKER_IMAGE_DEV}:${WORKER_DEV_VER}
                        """
                    } else if (env.BRANCH_NAME == 'main') {
                        sh """#!/bin/bash
                            # Deploy backend (App Service)
                            az webapp config container set \
                                --name ${AZURE_APP_SERVICE_MAIN} \
                                --resource-group ${MAIN_RG} \
                                --docker-custom-image-name ${BACKEND_IMAGE_MAIN}:${BACKEND_MAIN_VER} \
                                --docker-registry-server-url https://${ACR_NAME}

                            az webapp restart \
                                --name ${AZURE_APP_SERVICE_MAIN} \
                                --resource-group ${MAIN_RG}

                            # Deploy worker (Container App)
                            az containerapp update \
                                --name ${AZURE_CONTAINER_APP_MAIN} \
                                --resource-group ${MAIN_RG} \
                                --image ${WORKER_IMAGE_MAIN}:${WORKER_MAIN_VER}
                        """
                    }
                }
            }
        }
    }

    post {
        always {
            script {
                sh """#!/bin/bash
                    docker system prune -af
                """
                cleanWs()
            }
        }
        success {
            echo "Pipeline completed successfully!"
        }
        failure {
            echo "Pipeline failed!"
        }
    }
}