terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Declarative provisioning of the box this app runs on (EC2 + Elastic IP + Security
# Group) — deliberately not ECS/Fargate/RDS: this app is a single SQLite-backed
# process, so a VPC/ALB/ECS rewrite would be "more AWS" for no real benefit. Same
# scope decision, same safety properties (no-default SSH CIDRs, DNS only when asked
# for), as ../../do-vm-terraform's DigitalOcean module — this is its AWS counterpart.
resource "aws_security_group" "this" {
  name        = "${var.name}-sg"
  description = "lantern-analytics: SSH restricted to allowed_ssh_cidrs, HTTP/HTTPS open to the world"
  vpc_id      = var.vpc_id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.allowed_ssh_cidrs
  }

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name}-sg" }
}

resource "aws_instance" "this" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.this.id]
  key_name               = var.key_name
  user_data              = var.user_data

  tags = { Name = var.name }
}

resource "aws_eip" "this" {
  instance = aws_instance.this.id
  domain   = "vpc"
  tags     = { Name = "${var.name}-eip" }
}

resource "aws_route53_record" "this" {
  count   = var.zone_id == null ? 0 : 1
  zone_id = var.zone_id
  name    = var.subdomain
  type    = "A"
  ttl     = 300
  records = [aws_eip.this.public_ip]
}
