# Практическая работа № 7 — метрики приложения

В работе используется полнофункциональное приложение «Сохранение времени»: Vue-интерфейс, Express API и MySQL. Каталог `app` — самостоятельная копия исходного учебного проекта.

## Запуск

Из каталога `PR_7_Docker`:

```powershell
Copy-Item .env.example .env
# В .env задайте собственные пароли MYSQL_ROOT_PASSWORD и GRAFANA_ADMIN_PASSWORD.
docker compose up --build -d
docker compose ps
```

- Приложение: http://localhost:19999
- Метрики API в формате Prometheus: http://localhost:15555/metrics
- Prometheus: http://localhost:19090
- Grafana: http://localhost:13000 (просмотр дашборда открыт; пароль администратора задается через `GRAFANA_ADMIN_PASSWORD` в `.env`)

Prometheus опрашивает API каждые 5 секунд. Grafana автоматически настраивает источник Prometheus и дашборд, устанавливает отдельный панельный плагин Grafana Labs Treemap (`marcusolsson-treemap-panel`).
В запросах графиков `/healthz` исключен, чтобы проверки готовности контейнера не подменяли пользовательскую нагрузку.

## Метрики

| Метрика | Значение |
| --- | --- |
| `time_app_http_requests_total` | Суммарное число завершенных HTTP-запросов с метками метода, маршрута и статуса. |
| `time_app_http_request_duration_seconds` | Гистограмма длительности запросов; из нее рассчитывается p95. |
| `time_app_times_current` | Текущее число записей времени в таблице MySQL. |
| `time_app_times_created_total` | Сколько записей создано за все время. |
| `time_app_times_deleted_total` | Сколько записей удалено за все время. |
| `time_app_mysql_up` | 1 — соединение API с MySQL работает; 0 — недоступно. |
| `time_app_process_uptime_seconds` | Время работы текущего процесса Node.js. |
| `up` | Результат последнего scrape Prometheus: 1 — цель доступна. |

Дашборд обновляется каждые 5 секунд. Плитки Treemap показывают долю HTTP-запросов по методам; площадь плитки соответствует числу запросов.

## Сохранение после перезапуска

Счетчики API `time_app_http_requests_total`, `time_app_times_created_total` и `time_app_times_deleted_total` хранятся в таблице `app_metric_counters` в MySQL. При старте API значения загружаются обратно в Prometheus client. История всех scrape хранится в TSDB Prometheus на именованном томе `prometheus-data`, срок хранения — 30 дней. Данные записей MySQL хранятся в `mysql-data`, а настройки и панель Grafana — в `grafana-data`.

Проверка продолжения счетчиков:

```powershell
Invoke-WebRequest http://localhost:15555/times -UseBasicParsing
docker compose restart api
Invoke-WebRequest http://localhost:15555/metrics -UseBasicParsing
```

`docker compose down` удаляет контейнеры, но оставляет три тома и накопленные значения. `docker compose down -v` удаляет и тома вместе с данными.
