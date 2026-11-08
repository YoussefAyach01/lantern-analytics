# Runs against a mocked AWS provider so the module's wiring can be validated
# (plan-time) without a real AWS account, IAM user, or credentials.
mock_provider "aws" {}

run "plans_instance_eip_security_group_and_no_dns_when_zone_unset" {
  command = plan

  module {
    source = "../modules/aws-vm"
  }

  variables {
    name              = "test-vm"
    ami_id            = "ami-0123456789abcdef0"
    subnet_id         = "subnet-0123456789abcdef0"
    vpc_id            = "vpc-0123456789abcdef0"
    allowed_ssh_cidrs = ["1.2.3.4/32"]
  }

  assert {
    condition     = aws_instance.this.tags["Name"] == "test-vm"
    error_message = "instance Name tag should match var.name"
  }

  assert {
    condition     = aws_eip.this.domain == "vpc"
    error_message = "the Elastic IP should be a VPC-scoped EIP"
  }

  assert {
    condition     = length(aws_route53_record.this) == 0
    error_message = "no DNS record should be planned when zone_id is null"
  }
}

run "plans_dns_record_when_zone_and_domain_set" {
  command = plan

  module {
    source = "../modules/aws-vm"
  }

  variables {
    name              = "test-vm"
    ami_id            = "ami-0123456789abcdef0"
    subnet_id         = "subnet-0123456789abcdef0"
    vpc_id            = "vpc-0123456789abcdef0"
    allowed_ssh_cidrs = ["1.2.3.4/32"]
    zone_id           = "Z1234567890ABC"
    domain            = "example.com"
    subdomain         = "analytics"
  }

  assert {
    condition     = length(aws_route53_record.this) == 1
    error_message = "one DNS record should be planned when zone_id is set"
  }

  assert {
    condition     = aws_route53_record.this[0].name == "analytics"
    error_message = "DNS record name should match var.subdomain"
  }

  assert {
    condition     = aws_route53_record.this[0].type == "A"
    error_message = "DNS record should be an A record pointing at the Elastic IP"
  }
}

run "rejects_open_ssh_by_forcing_explicit_cidrs" {
  command = plan

  module {
    source = "../modules/aws-vm"
  }

  variables {
    name              = "test-vm"
    ami_id            = "ami-0123456789abcdef0"
    subnet_id         = "subnet-0123456789abcdef0"
    vpc_id            = "vpc-0123456789abcdef0"
    allowed_ssh_cidrs = ["10.0.0.5/32"]
  }

  assert {
    condition = anytrue([
      for rule in aws_security_group.this.ingress :
      rule.from_port == 22 && rule.to_port == 22 && contains(rule.cidr_blocks, "10.0.0.5/32")
    ])
    error_message = "SSH ingress rule should use the caller-supplied CIDR, never a wildcard"
  }

  assert {
    condition = !anytrue([
      for rule in aws_security_group.this.ingress :
      rule.from_port == 22 && contains(rule.cidr_blocks, "0.0.0.0/0")
    ])
    error_message = "SSH ingress rule must never include 0.0.0.0/0"
  }
}

run "http_and_https_remain_open_to_the_world" {
  command = plan

  module {
    source = "../modules/aws-vm"
  }

  variables {
    name              = "test-vm"
    ami_id            = "ami-0123456789abcdef0"
    subnet_id         = "subnet-0123456789abcdef0"
    vpc_id            = "vpc-0123456789abcdef0"
    allowed_ssh_cidrs = ["1.2.3.4/32"]
  }

  assert {
    condition = anytrue([
      for rule in aws_security_group.this.ingress :
      rule.from_port == 80 && contains(rule.cidr_blocks, "0.0.0.0/0")
    ])
    error_message = "HTTP should be open to the world so the dashboard/collect endpoint is reachable"
  }

  assert {
    condition = anytrue([
      for rule in aws_security_group.this.ingress :
      rule.from_port == 443 && contains(rule.cidr_blocks, "0.0.0.0/0")
    ])
    error_message = "HTTPS should be open to the world"
  }
}
