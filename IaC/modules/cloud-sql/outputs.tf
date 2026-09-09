output "instance_connection_name" {
  description = "For the Cloud SQL Auth Proxy / connector, format PROJECT:REGION:INSTANCE."
  value       = google_sql_database_instance.this.connection_name
}

output "instance_name" {
  description = "Raw instance name — for a caller that needs to attach an additional google_sql_database to this same instance (e.g. glitchtip's) without this module knowing about that consumer."
  value       = google_sql_database_instance.this.name
}

output "private_ip_address" {
  value = google_sql_database_instance.this.private_ip_address
}

output "database_name" {
  value = google_sql_database.app.name
}
