output "service_name" {
  description = "For the networking module's health check to target."
  value       = kubernetes_service_v1.glitchtip.metadata[0].name
}

output "namespace" {
  value = kubernetes_namespace_v1.glitchtip.metadata[0].name
}
