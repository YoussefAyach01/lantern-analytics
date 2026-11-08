terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

module "vm" {
  source = "../../modules/aws-vm"

  name              = "lantern-analytics"
  instance_type     = "t3.micro"
  ami_id            = var.ami_id
  subnet_id         = var.subnet_id
  vpc_id            = var.vpc_id
  key_name          = var.key_name
  allowed_ssh_cidrs = var.allowed_ssh_cidrs
  zone_id           = var.zone_id
  domain            = var.domain
  subdomain         = "analytics"
}

variable "aws_region" {
  type    = string
  default = "eu-west-3"
}

variable "ami_id" {
  type        = string
  description = "AMI id for your region (e.g. latest Amazon Linux 2023)."
}

variable "subnet_id" {
  type        = string
  description = "Subnet id in your account (e.g. a subnet of the default VPC)."
}

variable "vpc_id" {
  type        = string
  description = "VPC id that subnet_id belongs to."
}

variable "key_name" {
  type    = string
  default = null
}

variable "allowed_ssh_cidrs" {
  type        = list(string)
  description = "Your own IP in CIDR form, e.g. [\"1.2.3.4/32\"]."
}

variable "zone_id" {
  type    = string
  default = null
}

variable "domain" {
  type    = string
  default = null
}

output "public_ip" {
  value = module.vm.public_ip
}

output "fqdn" {
  value = module.vm.fqdn
}
