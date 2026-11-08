# terraform test needs the provider's schema locally to generate mock data, even
# though mock_provider never makes real API calls or needs AWS credentials.
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
