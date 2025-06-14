// main.ts — GitHub Action на Deno для автоматического релиза по коммитам

import { getInput, info, setFailed, warning } from "npm:@actions/core";
import { context, getOctokit } from "npm:@actions/github";
import semver from "npm:semver";
import { exec } from "npm:@actions/exec";
import mime from "npm:mime-types";
import { Buffer } from "node:buffer";
import * as process from "node:process";
import { readFileSync } from "node:fs";
import { expandGlob, isFile, path } from "./fs-glob.ts";

// === ТОП-LEVEL ===
const main = async () => {
  // Входные параметры
  const GITHUB_TOKEN = getInput("GITHUB_TOKEN", { required: true });
  const LINT_AND_TESTS_COMMAND = getInput("LINT_AND_TESTS_COMMAND");
  const BUILD_COMMAND = getInput("BUILD_COMMAND");
  const ASSET_PATTERNS = (getInput("ASSET_PATTERNS") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const OPENAI_API_KEY = getInput("OPENAI_API_KEY");
  const OPENAI_API_MODEL = getInput("OPENAI_API_MODEL") || "gpt-4";
  const OPENAI_API_BASE_URL = getInput("OPENAI_API_BASE_URL");
  const DISCORD_WEBHOOK = getInput("DISCORD_WEBHOOK"); // для уведомлений в Slack
  const ALLOWED_BRANCH = getInput("ALLOWED_BRANCH") || "main"; // ветка для релизов
  const DRAFT_RELEASE = getInput("DRAFT_RELEASE") === "true"; // черновой релиз?
  const PRERELEASE = getInput("PRERELEASE") === "true"; // пререлиз?

  const octokit = getOctokit(GITHUB_TOKEN);
  const { owner, repo } = context.repo;
  const sha = context.sha;

  // 0. Парсим команду релиза в сообщении коммита
  const commitMessage = context.payload.head_commit?.message || "";
  const releaseType = parseReleaseType(commitMessage);
  if (!releaseType) {
    if (commitMessage.includes("!release")) {
      throw new Error(
        "В сообщении коммита не найдена команда релиза (!release: major/minor/patch или !breaking)",
      );
    }
    process.exit(0);
  }

  // 1. Проверяем чистоту рабочего дерева и ветку
  await assertCleanWorkingDir();
  await assertOnBranch(ALLOWED_BRANCH);

  // 2. Получаем последний релизный тег
  const lastTag = await getLastReleaseTag(octokit, owner, repo);
  info(`Последний тег: ${lastTag ?? "не найден"}`);

  // 3. Формируем новую версию и создаём git-тег
  const newTag = bumpVersion(lastTag, releaseType);
  info(`Новый тег: ${newTag}`);
  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/tags/${newTag}`,
    sha,
  });

  // 4. Читаем коммиты с прошлого тега и валидируем по Conventional Commits
  const commits = await getCommitsSince(octokit, owner, repo, lastTag, sha);
  validateCommitMessages(commits);

  // 5. Запускаем тесты, линтинг и сборку
  if (LINT_AND_TESTS_COMMAND) {
    info(`Выполняем lint && test: ${LINT_AND_TESTS_COMMAND}`);
    await runCommand(LINT_AND_TESTS_COMMAND);
  }
  if (BUILD_COMMAND) {
    info(`Выполняем сборку: ${BUILD_COMMAND}`);
    await runCommand(BUILD_COMMAND);
  }

  // 6. Генерим changelog (список + ИИ-резюме)
  const changelog = await generateChangelog(
    commits,
    OPENAI_API_KEY,
    OPENAI_API_MODEL,
    OPENAI_API_BASE_URL,
  );

  // 7. Опции релиза: draft/prerelease по флагам
  const release = await octokit.rest.repos.createRelease({
    owner,
    repo,
    tag_name: newTag,
    name: `Release ${newTag}`,
    body: changelog,
    draft: DRAFT_RELEASE,
    prerelease: PRERELEASE,
  });

  // 8. Загружаем артефакты
  if (ASSET_PATTERNS.length) {
    const assetPaths = await getAssetPaths(ASSET_PATTERNS);
    await uploadAssets(octokit, release.data.upload_url, assetPaths);
  }

  // 9. Уведомляем в Discord (если указан webhook)
  if (DISCORD_WEBHOOK) {
    await notifyDiscord(
      DISCORD_WEBHOOK,
      `:tada: Выпущен релиз ${newTag} в ${owner}/${repo}`,
    );
  }

  info("Релиз успешно создан");
};

main().catch((err) => setFailed(err.message));

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

// Проверка «чистой» рабочей директории
async function assertCleanWorkingDir() {
  let output = "";
  await exec("git", ["status", "--porcelain"], {
    listeners: { stdout: (data: Buffer) => output += data.toString() },
  });
  if (output.trim()) {
    throw new Error(
      "Рабочая директория не чиста (unstaged/uncommitted changes)",
    );
  }
}

// Проверка текущей ветки
async function assertOnBranch(expected: string) {
  let branch = "";
  await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    listeners: { stdout: (data: Buffer) => branch += data.toString() },
  });
  branch = branch.trim();
  if (branch !== expected) {
    throw new Error(
      `Релизы разрешены только из ветки '${expected}', текущая ветка '${branch}'`,
    );
  }
}

// Утилита для выполнения команд
async function runCommand(command: string) {
  const [cmd, ...args] = command.split(/\s+/);
  await exec(cmd, args);
}

// Парсинг типа релиза
function parseReleaseType(message: string): semver.ReleaseType | undefined {
  const m = message.match(/!release:\s*(major|minor|patch)/i);
  return m ? (m[1].toLowerCase() as semver.ReleaseType) : undefined;
}

// Получение последнего тега релизов
async function getLastReleaseTag(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
): Promise<string | undefined> {
  try {
    const latest = await octokit.rest.repos.getLatestRelease({ owner, repo });
    return latest.data.tag_name;
  } catch (err: any) {
    if (err.status === 404) return undefined;
    throw err;
  }
}

// Вычисление новой версии semver
function bumpVersion(
  lastTag: string | undefined,
  releaseType?: semver.ReleaseType,
): string {
  if (!releaseType) throw new Error("Не указан тип релиза для bumpVersion");
  if (!lastTag) {
    // первый релиз
    return releaseType === "major"
      ? "1.0.0"
      : releaseType === "minor"
      ? "0.1.0"
      : "0.0.1";
  }
  const next = semver.inc(lastTag, releaseType);
  if (!next) throw new Error(`Не удалось увеличить версию от ${lastTag}`);
  return next;
}

// Чтение коммитов с прошлого тега
async function getCommitsSince(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  lastTag: string | undefined,
  head: string,
) {
  if (lastTag) {
    const comp = await octokit.rest.repos.compareCommits({
      owner,
      repo,
      base: lastTag,
      head,
    });
    return comp.data.commits;
  } else {
    return await octokit.paginate(octokit.rest.repos.listCommits, {
      owner,
      repo,
    });
  }
}

// Валидация сообщений коммитов по Conventional Commits
function validateCommitMessages(commits: Array<{ commit: any }>) {
  const invalid = commits.filter((c) =>
    !/^(feat|fix|docs|chore|refactor|style|perf)(\(.+\))?:/.test(
      c.commit.message,
    )
  );
  if (invalid.length) {
    const msgs = invalid.map((c) => c.commit.message.split("\n")[0]).join("\n");
    console.log(`Найдены неконвенциональные сообщения коммитов:\n${msgs}`);
  }
}

// Генерация changelog + опциональное AI-резюме
async function generateChangelog(
  commits: Array<{ sha: string; commit: any; author?: any }>,
  apiKey?: string,
  model = "gpt-4",
  baseUrl = "https://api.openai.com/v1/",
): Promise<string> {
  const lines = commits.map((c) => {
    const title = c.commit.message.split("\n")[0];
    const short = c.sha.slice(0, 7);
    const login = c.author?.login || c.commit.author.name;
    return `- ${title} (${short}) by @${login}`;
  }).join("\n");

  let summary = "";
  if (apiKey) {
    summary = "## Changelog Summary\n\n" +
      await getAISummary(lines, apiKey, model, baseUrl) +
      "\n\n";
  }
  return `${summary}## What's Changed\n\n${lines}`;
}

// Запрос к OpenAI для сводки
async function getAISummary(
  bullets: string,
  apiKey: string,
  model: string,
  baseUrl: string,
): Promise<string> {
  const resp = await fetch(
    `${baseUrl}/chat/completions`.replace(/\/+/g, "/"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Ты — помощник, который на основе списка изменений генерирует 2–3 предложения.",
          },
          {
            role: "user",
            content:
              `Вот список изменений:\n${bullets}\n\nСделай короткое резюме.`,
          },
        ],
      }),
    },
  );
  try {
    const j = await resp.json();
    return stripThinkBlocks(j.choices?.[0]?.message?.content?.trim() || "");
  } catch (err: any) {
    warning(err);
    return "";
  }
}

// Получение списка артефактов по glob-шаблонам
async function getAssetPaths(patterns: string[]): Promise<string[]> {
  const result: string[] = [];
  for (const pat of patterns) {
    for await (const file of expandGlob(pat)) {
      if (await isFile(file)) {
        console.log("✓", path.relative(process.cwd(), file));
        result.push(path.relative(process.cwd(), file));
      }
    }
  }
  return result;
}

// Загрузка артефактов в релиз
async function uploadAssets(
  octokit: ReturnType<typeof getOctokit>,
  uploadUrl: string,
  paths: string[],
) {
  for (const path of paths) {
    const data = readFileSync(path);
    const name = path.split("/").pop()!;
    const contentType = mime.lookup(name) || "application/octet-stream";
    await octokit.rest.repos.uploadReleaseAsset({
      url: uploadUrl,
      headers: {
        "content-type": contentType,
        "content-length": data.byteLength.toString(),
      },
      name,
      data,
    });
    info(`Загружен артефакт: ${name}`);
  }
}

function stripThinkBlocks(input: string): string {
  // Для удаления <think>…</think>
  return input.replace(/<think>[\s\S]*?<\/think>/gs, "").trim();
}

/*
// Удаление тега по имени
async function deleteTag(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  tag: string,
) {
  await octokit.rest.git.deleteRef({ owner, repo, ref: `tags/${tag}` });
}

// Удаление релиза по ID
async function deleteRelease(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  releaseId: number,
) {
  await octokit.rest.repos.deleteRelease({
    owner,
    repo,
    release_id: releaseId,
  });
}
*/

// Уведомление в Discord через Webhook
async function notifyDiscord(webhookUrl: string, message: string) {
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  });
}
