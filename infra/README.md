# infra — AWS Terraform module for lantern-analytics

A Terraform module that provisions a single EC2 instance + Elastic IP + Security
Group + an optional Route 53 record — the AWS counterpart to
[`../../do-vm-terraform`](../../do-vm-terraform)'s DigitalOcean droplet module, same
structure, same safety properties.

## Structure

```
modules/aws-vm/   the reusable module (instance, security group, EIP, DNS record)
examples/basic/   a runnable root config that consumes the module
tests/            terraform test suite, run against a mocked AWS provider
```

## Why EC2, not ECS/Fargate/RDS

This app is one process backed by a single SQLite file. ECS/Fargate + RDS would be
"more AWS" on paper but would force dropping SQLite for no real benefit and balloon
the scope into a VPC/ALB/ECS project. EC2 + EIP + SG demonstrates real,
interview-relevant AWS primitives at the right scope for what this app actually is.

## Usage

```bash
cd examples/basic
cp terraform.tfvars.example terraform.tfvars   # fill in your own AMI/subnet/VPC/CIDR
terraform init
terraform plan
terraform apply
```

Required inputs (see `modules/aws-vm/variables.tf` for full docs):

| Variable               | Purpose                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `ami_id`               | AMI id for your region (e.g. latest Amazon Linux 2023) — no default, picked explicitly per region      |
| `subnet_id` / `vpc_id` | An existing subnet/VPC in your account — this module provisions compute, not networking                |
| `allowed_ssh_cidrs`    | Your own IP(s) in CIDR form — the security group has no default, so open SSH is impossible by accident |
| `zone_id` / `domain`   | An existing Route 53 zone, or both `null` to skip DNS                                                  |

## Development

```bash
terraform fmt -check -recursive
terraform -chdir=modules/aws-vm init -backend=false && terraform -chdir=modules/aws-vm validate
terraform -chdir=examples/basic init -backend=false && terraform -chdir=examples/basic validate
cd tests && terraform init -backend=false && terraform test
```

`terraform test` uses `mock_provider "aws" {}`, so the whole suite (4 checks:
instance/EIP/security-group get planned, the Route 53 record only appears when both
`zone_id` and `domain` are given, the SSH rule always carries the caller's CIDR
rather than a wildcard, and HTTP/HTTPS stay open) runs with **zero AWS credentials
and no real AWS account** — CI runs it on every push (`.github/workflows/ci.yml`).

All of the above was run in this environment and passed:

```
terraform fmt -check -recursive        -> clean, no diff
modules/aws-vm: init + validate        -> Success
examples/basic: init + validate        -> Success
tests: terraform test                  -> 4 passed, 0 failed
```

## Status

**Not applied against real infrastructure.** No AWS account exists for this project
yet (confirmed with Youssef before building this). `terraform apply` needs an AWS
account + IAM user with EC2/Route53 permissions, which is a real
account/credentials decision for Youssef to make, not something to automate around.
The module is validated (`terraform validate`, `terraform test`) to the same bar as
`../do-vm-terraform` was before its own DigitalOcean account existed. Once an AWS
account + credentials exist:

```bash
cd examples/basic
terraform apply
# verify: curl the Elastic IP on :80, ssh in, confirm docker is installed,
# deploy this repo + `docker compose up -d`, confirm /health responds
terraform destroy   # if this is a demo run, not a kept deployment
```

## What I'd add next

- A `user_data` variant that also pulls and runs this repo's own Docker image from a
  registry (none is published yet — there's no registry account either).
- A second example wiring the Elastic IP straight into a Route 53 record for a real
  subdomain once Youssef has a domain he wants to use for this.
