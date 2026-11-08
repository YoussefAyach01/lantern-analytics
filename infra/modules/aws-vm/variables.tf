variable "name" {
  description = "Name tag for the instance, security group, and (if created) DNS record."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type."
  type        = string
  default     = "t3.micro"
}

variable "ami_id" {
  description = "AMI id for the instance (e.g. the latest Amazon Linux 2023 AMI for your region). No default — pick the AMI for your own region explicitly rather than have the module guess one that may be stale or wrong for your region."
  type        = string
}

variable "subnet_id" {
  description = "Subnet to launch the instance in (e.g. a subnet in your account's default VPC). No default — this module provisions compute, not a VPC."
  type        = string
}

variable "vpc_id" {
  description = "VPC id that var.subnet_id belongs to, used for the security group."
  type        = string
}

variable "key_name" {
  description = "Name of an EC2 key pair already created in your AWS account, for SSH access. Leave null to launch with no SSH key (you'd then rely on SSM/console only)."
  type        = string
  default     = null
}

variable "allowed_ssh_cidrs" {
  description = "CIDR blocks allowed to reach port 22. No default — forces an explicit choice, so open-to-the-world SSH is impossible by accident."
  type        = list(string)
}

variable "zone_id" {
  description = "An existing Route 53 hosted zone id to add an A record in. Leave null to skip DNS entirely."
  type        = string
  default     = null
}

variable "domain" {
  description = "The domain name that var.zone_id manages (e.g. \"example.com\"). Only used to build the fqdn output; the A record itself is addressed by var.zone_id. Leave null along with zone_id to skip DNS."
  type        = string
  default     = null
}

variable "subdomain" {
  description = "Record name to create in var.zone_id (e.g. \"app\" for app.example.com, or \"@\"/the zone's own apex name for the bare domain)."
  type        = string
  default     = "@"
}

variable "user_data" {
  description = "EC2 user-data script. Defaults to a baseline that installs Docker + the Compose plugin on Amazon Linux so `docker compose up -d` (using this repo's docker-compose.yml) works once the app code is deployed to the box."
  type        = string
  default     = <<-EOT
    #!/bin/bash
    set -euo pipefail
    dnf update -y
    dnf install -y docker
    systemctl enable --now docker
    DOCKER_CONFIG="/usr/local/lib/docker/cli-plugins"
    mkdir -p "$DOCKER_CONFIG"
    curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
      -o "$DOCKER_CONFIG/docker-compose"
    chmod +x "$DOCKER_CONFIG/docker-compose"
    usermod -aG docker ec2-user || true
  EOT
}
