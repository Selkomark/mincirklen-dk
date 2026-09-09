output "host" {
  description = "IP the tRPC API, WebSocket service, and web-app should connect to. A ClusterIP (not cluster DNS) so it's reachable from Cloud Run via the Serverless VPC Access connector, not just from in-cluster pods."
  value = var.use_memorystore ? google_redis_instance.this[0].host : (
    kubernetes_service_v1.redis[0].spec[0].cluster_ip
  )
}

output "port" {
  value = var.use_memorystore ? google_redis_instance.this[0].port : 6379
}
