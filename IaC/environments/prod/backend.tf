// Terraform backend blocks can't use variables, so the bucket name here is a
// literal — it must match whatever IaC/bootstrap actually created (bucket
// names are globally unique across all of GCP, so the real name may differ
// from this default). CI overrides it explicitly anyway via
// `terraform init -backend-config="bucket=..."` (see .github/workflows),
// so this value only matters for a human running terraform locally.
terraform {
  backend "gcs" {
    bucket = "mincirklen-terraform-state"
    prefix = "env/prod"
  }
}
