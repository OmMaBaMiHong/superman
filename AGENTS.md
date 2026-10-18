# Project instructions

## 本地共享中间件（2026-10-18 用户裁决）

- 本机所有项目只共用一个 PostgreSQL、一个 Redis、一个 MinIO，包含原 Homebrew PostgreSQL。统一实例为 `local-postgres:5432`、`local-redis:6379`、`local-minio:9000`，宿主连接 `127.0.0.1` 对应端口；容器加入外部网络 `local-infra`。
- 基础设施由 `/Users/wade/work-space/local-infra/compose.yml` 独立管理。启动/检查使用 `docker compose -f /Users/wade/work-space/local-infra/compose.yml --env-file /Users/wade/work-space/local-infra/.env up -d` / `ps`。项目仅使用本地 `compose.shared.yml` 与已有连接配置，不创建私有 PG、Redis、MinIO 或额外测试栈；Homebrew PostgreSQL 服务及程序已卸载，禁止重新安装或恢复自启动。
- 按项目分数据库及账号、Redis 逻辑库、S3 桶及访问账号。Redis 逻辑库只隔离键名，不是安全沙箱；不得使用 `FLUSHALL`。新项目先在共享实例登记自己的库和账号，不复制中间件容器。
- 原卷及迁移备份必须保留；禁止 `down -v`、全局 prune 或以空库替代原账号和数据。共享卷是 external，不随业务项目删除。切换完成必须核对数据、扩展和真实连接，不能以 Compose 校验代替业务验收。
- 本地与线上复用业务代码，只区分部署配置。线上原单机/独立部署文件不受本地共享配置影响。Neo4j、FalkorDB、路由引擎等不同能力的服务按需使用，不当作普通 PG/Redis 数据删除；非当前使用的服务保持停止。
- Skoob 开发与真实回归只使用 master 的同一个 9002 统一应用容器，不另起预览端口或账号测试环境。
