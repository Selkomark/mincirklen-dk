output "topic_id" {
  value = google_pubsub_topic.main.id
}

output "topic_name" {
  value = google_pubsub_topic.main.name
}

output "dead_letter_topic_id" {
  value = google_pubsub_topic.dead_letter.id
}

output "subscription_name" {
  value = google_pubsub_subscription.main_push.name
}
