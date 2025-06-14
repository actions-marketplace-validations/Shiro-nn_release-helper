<!-- README.md for Auto Release action -->

<h1 align="center">🚀 Auto Release <sup><sub>Deno GitHub Action</sub></sup></h1>
<p align="center">
  <img src="https://img.shields.io/badge/deno-%5E1.44-brightgreen?logo=deno&style=for-the-badge" alt="Deno" />
  <img src="https://img.shields.io/github/v/release/Shiro-nn/release-helper?label=latest&style=for-the-badge" alt="Latest Release" />
  <img src="https://img.shields.io/github/actions/workflow/status/Shiro-nn/release-helper/release.yml?branch=main&style=for-the-badge" alt="CI" />
</p>

---

## ✨ Описание

Auto Release — это **GitHub Action** на **Deno**, который:

* 🔍 Анализирует коммиты на директивы !release: major/minor/patch и !breaking
* ⚙️ Запускает команду линтинга и тестов через инпут LINT\_AND\_TESTS\_COMMAND
* 📦 Собирает проект через команду BUILD\_COMMAND
* 🏷️ Создаёт SemVer-тег и релиз в GitHub
* 📝 Генерирует **CHANGELOG** + AI-резюме (через OpenAI) ✍️
* 📂 Загружает артефакты по glob-шаблонам из ASSET\_PATTERNS
* 🔄 Кэширует Deno-зависимости для быстрого CI
* 📣 Отправляет уведомления в **Discord** через Webhook 💬

---

## 📥 Установка

Добавьте шаг в свой workflow:

```yaml
- name: Auto Release 🚀
  uses: <owner>/<repo>@v1
  with:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    # Сборка проекта
    BUILD_COMMAND: "deno task build"
    # Линт и тесты
    LINT_AND_TESTS_COMMAND: "deno lint && deno test"
    # Шаблоны артефактов
    ASSET_PATTERNS: "dist/**/*.zip dist/**/*.tar.gz"
    # Настройка ветки и релиза
    ALLOWED_BRANCH: "main"
    DRAFT_RELEASE: "false"
    PRERELEASE: "false"
    # Discord уведомления
    DISCORD_WEBHOOK: ${{ secrets.DISCORD_RELEASE_WEBHOOK }}
```

---

## ⚙️ Inputs

| 🏷️ Параметр             | Обязателен | По умолчанию                                 | Описание                                                          |
|--------------------------|------------|----------------------------------------------|-------------------------------------------------------------------|
| `GITHUB_TOKEN`           | ✅          | —                                            | Токен GitHub для тегов, релиза и загрузки артефактов              |
| `LINT_AND_TESTS_COMMAND` | ❌          | `deno lint && deno test`                     | Команда для линтинга и тестов                                     |
| `BUILD_COMMAND`          | ❌          | `deno task build`                            | Команда сборки проекта                                            |
| `ASSET_PATTERNS`         | ❌          | —                                            | Glob‑шаблоны файлов‑артефактов для релиза (напр. `dist/**/*.zip`) |
| `OPENAI_API_KEY`         | ❌          | —                                            | Ключ OpenAI для AI‑резюме                                         |
| `OPENAI_API_MODEL`       | ❌          | `gpt-4`                                      | Модель OpenAI                                                     |
| `OPENAI_API_BASE_URL`    | ❌          | `https://api.openai.com/v1/chat/completions` | Endpoint Chat Completions API                                     |
| `ALLOWED_BRANCH`         | ❌          | `main`                                       | Разрешённая ветка для релизов                                     |
| `DRAFT_RELEASE`          | ❌          | `false`                                      | Создавать черновик релиза?                                        |
| `PRERELEASE`             | ❌          | `false`                                      | Помечать как prerelease?                                          |
| `DISCORD_WEBHOOK`        | ❌          | —                                            | URL Discord Webhook для уведомлений                               |

> ⚡ **Совет:** если у вас нет линтинга или тестов — оставьте `LINT_AND_TESTS_COMMAND` пустым. Action пропустит этот шаг.

---

## 🚀 Quick Start

```yaml
name: Release
on:
  push:
    branches: [ main ]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          cache: true
      - name: Auto Release
        uses: <owner>/<repo>@v1
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          BUILD_COMMAND: "deno task build"
          LINT_AND_TESTS_COMMAND: "deno lint && deno test"
          ASSET_PATTERNS: "dist/**/*.zip"
          DISCORD_WEBHOOK: ${{ secrets.DISCORD_RELEASE_WEBHOOK }}
```

---

## 🔧 Как это работает

1. 📂 **Проверка окружения**

    * Убедиться, что рабочая директория чиста и текущая ветка соответствует `ALLOWED_BRANCH`.
2. 🔍 **Анализ коммита**

    * Поиск директивы <kbd>!release: major/minor/patch</kbd> или <kbd>!breaking</kbd> в сообщении последнего коммита.
3. 📈 **SemVer bump**

    * Вычисление новой версии на основании последнего релизного тега и типа релиза.
4. ✅ **Lint & Test**

    * Выполнение команды из `LINT_AND_TESTS_COMMAND` (например, <code>deno lint && deno test</code>).
5. 🛠️ **Сборка проекта**

    * Выполнение `BUILD_COMMAND` (например, <code>deno task build</code>).
6. 🏷️ **Создание тега и релиза**

    * Создать git-тег и GitHub Release с опциями `DRAFT_RELEASE`/`PRERELEASE`.
7. 📝 **CHANGELOG & AI-сводка**

    * Сформировать список изменений и сгенерировать AI-краткое резюме через OpenAI (при наличии `OPENAI_API_KEY`).
8. 📂 **Загрузка артефактов**

    * Загрузить все файлы, соответствующие шаблонам из `ASSET_PATTERNS`.
9. 📣 **Уведомление в Discord**

    * Отправить POST-запрос на URL из `DISCORD_WEBHOOK` с телом `{ "content": "..." }`.

---

## 📄 Лицензия

MIT License — см. файл <code>LICENSE</code> для подробностей.
