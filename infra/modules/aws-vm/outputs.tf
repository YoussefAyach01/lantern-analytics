output "instance_id" {
  value = aws_instance.this.id
}

output "security_group_id" {
  value = aws_security_group.this.id
}

output "public_ip" {
  description = "The Elastic IP address (stable across instance stop/start, unlike the ephemeral public IP)."
  value       = aws_eip.this.public_ip
}

output "fqdn" {
  description = "Full hostname if both domain and zone_id were provided, else null."
  value       = var.domain == null ? null : "${var.subdomain == "@" ? "" : "${var.subdomain}."}${var.domain}"
}
