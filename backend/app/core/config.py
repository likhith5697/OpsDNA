from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    jira_base_url: str
    jira_email: str
    jira_api_token: str
    jira_project_key: str

    snow_instance: str | None = None
    snow_user: str | None = None
    snow_pass: str | None = None

    k8s_namespace: str = "production"

    prometheus_url: str = "http://localhost:9090"

    openai_api_key: str | None = None
    openai_model: str = "gpt-4o"

    # Days since last update before an in-progress ticket is considered "stuck".
    stale_days_threshold: int = 5

    # Certificates expiring within this many days are flagged by the cert agent.
    cert_expiry_threshold_days: int = 30

    github_token: str | None = None
    github_owner: str | None = None
    github_repo: str = "checkout-service"

    grafana_cloud_prom_url: str = "https://prometheus-prod-66-prod-us-east-3.grafana.net/api/prom"
    grafana_cloud_username: str | None = None
    grafana_cloud_api_key: str | None = None

    grafana_loki_url: str | None = None
    grafana_loki_username: str | None = None

    # SRE agent incident-detection thresholds for checkout-service.
    sre_error_rate_threshold: float = 5.0
    sre_p99_latency_threshold: float = 2000.0
    sre_order_success_threshold: float = 95.0


settings = Settings()
