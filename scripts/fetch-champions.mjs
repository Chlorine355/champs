#!/usr/bin/env node
/**
 * Собирает данные о всех чемпионах League of Legends:
 * имя, ссылку на портрет, эпитет и краткое описание.
 *
 * Источники:
 *   1. https://www.leagueoflegends.com/ru-ru/champions/ — список чемпионов
 *      (имена, портреты, ссылки на страницы).
 *   2. Страница каждого чемпиона — эпитет и описание из __NEXT_DATA__.
 *
 * Запуск:
 *   node scripts/fetch-champions.mjs
 *   node scripts/fetch-champions.mjs --limit 10 --delay 0
 *   node scripts/fetch-champions.mjs --out data.js
 *
 * Зависимостей нет, нужен Node.js 18+ (глобальный fetch).
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://www.leagueoflegends.com';
const LIST_URL = `${SITE}/ru-ru/champions/`;
const HEADERS = {
    'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'accept-language': 'ru-RU,ru;q=0.9',
    accept: 'text/html,application/xhtml+xml',
};
const IMAGE_SUFFIX = 'auto=format&fit=fill&q=80&w=415';

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? fallback : args[index + 1];
};

const OUT_PATH = path.resolve(ROOT, option('out', 'data.js'));
const LIMIT = Number(option('limit', '0')) || Infinity;
const DELAY_MS = Number(option('delay', '120'));

// ---------------------------------------------------------------- helpers

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ENTITIES = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    laquo: '«',
    raquo: '»',
    mdash: '—',
    ndash: '–',
    hellip: '…',
    thinsp: ' ',
};

const decodeEntities = (text) =>
    text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity) => {
        if (entity[0] === '#') {
            const code =
                entity[1].toLowerCase() === 'x'
                    ? Number.parseInt(entity.slice(2), 16)
                    : Number.parseInt(entity.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        return ENTITIES[entity.toLowerCase()] ?? match;
    });

/** Превращает HTML-описание в аккуратный plain text. */
const htmlToText = (html) =>
    decodeEntities(
        html
            .replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, ' ')
            .replace(/<[^>]+>/g, '')
    )
        .replace(/\s+/g, ' ')
        .trim();

const extractNextData = (html) => {
    const match = html.match(
        /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
    );
    if (!match) {
        throw new Error('не найден __NEXT_DATA__ — изменилась разметка страницы');
    }
    return JSON.parse(match[1]);
};

const request = async (url, attempts = 4) => {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const response = await fetch(url, {
                headers: HEADERS,
                signal: AbortSignal.timeout(30_000),
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return await response.text();
        } catch (error) {
            lastError = error;
            if (attempt < attempts) {
                await sleep(attempt * 1000);
            }
        }
    }
    throw new Error(`${url}: ${lastError.message}`);
};

const slugFromUrl = (url) => {
    const parts = url.split('?')[0].split('/').filter(Boolean);
    return parts.at(-1);
};

// ---------------------------------------------------------------- scraping

/** Список всех чемпионов: имя, портрет, ссылка на страницу. */
const fetchChampionList = async () => {
    const html = await request(LIST_URL);
    const page = extractNextData(html).props.pageProps.page;
    const grid = page.blades.find((blade) => blade.type === 'characterCardGrid');
    if (!grid) {
        throw new Error('на странице списка нет characterCardGrid');
    }

    let items = grid.items;
    const linkUrl = grid.async?.linkdata?.self;
    if ((!items || items.length === 0) && linkUrl) {
        const listJson = await request(new URL(linkUrl, SITE).href);
        items = JSON.parse(listJson).items;
    }
    if (!items || items.length === 0) {
        throw new Error('не удалось получить список чемпионов');
    }

    return items.map((item) => ({
        slug: slugFromUrl(item.action.payload.url),
        name: item.title,
        portrait: item.media?.url ?? '',
        pageUrl: new URL(item.action.payload.url, SITE).href,
    }));
};

/** Эпитет и описание со страницы конкретного чемпиона. */
const fetchChampionDetails = async (champion) => {
    const html = await request(champion.pageUrl);
    const page = extractNextData(html).props.pageProps.page;
    const masthead = page.blades.find((blade) => blade.type === 'characterMasthead');
    if (!masthead) {
        throw new Error('на странице нет characterMasthead');
    }

    const description = masthead.description?.body
        ? htmlToText(masthead.description.body)
        : '';

    return {
        slug: champion.slug,
        name: masthead.title || champion.name,
        subtitle: masthead.subtitle || '',
        description,
        splash: masthead.backdrop?.background?.url ?? '',
    };
};

const withImageParams = (url) => {
    if (!url) return url;
    const separator = url.includes('?') ? '&' : '?';
    // Не дублируем параметры, если они уже проставлены.
    if (url.includes('auto=format')) return url;
    return `${url}${separator}${IMAGE_SUFFIX}`;
};

// ---------------------------------------------------------------- output

const toDataJs = (champions) =>
    [
        '// Файл сгенерирован скриптом scripts/fetch-champions.mjs.',
        '// Источник: https://www.leagueoflegends.com/ru-ru/champions/',
        '// Не редактируйте вручную — перезапустите скрипт.',
        '',
        `globalThis.CHAMPIONS = ${JSON.stringify(champions, null, 4)};`,
        '',
    ].join('\n');

// ---------------------------------------------------------------- main

const main = async () => {
    console.log('Загружаю список чемпионов…');
    const list = await fetchChampionList();
    console.log(`Найдено чемпионов: ${list.length}`);

    const queue = list.slice(0, LIMIT === Infinity ? list.length : LIMIT);
    const champions = [];
    const failed = [];

    for (const [index, champion] of queue.entries()) {
        const counter = `[${String(index + 1).padStart(3, ' ')}/${queue.length}]`;
        try {
            const details = await fetchChampionDetails(champion);
            champions.push({
                name: details.name.toLocaleUpperCase('ru-RU'),
                subtitle: details.subtitle,
                description: details.description,
                src: withImageParams(champion.portrait),
                splash: details.splash,
                slug: details.slug,
            });
            console.log(`${counter} ${details.name} — ${details.subtitle}`);
        } catch (error) {
            failed.push(champion.slug);
            console.error(`${counter} ${champion.slug} — ОШИБКА: ${error.message}`);
        }
        if (DELAY_MS > 0 && index < queue.length - 1) {
            await sleep(DELAY_MS);
        }
    }

    champions.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    await writeFile(OUT_PATH, toDataJs(champions), 'utf8');
    console.log(`\nЗаписано ${champions.length} чемпионов в ${path.relative(ROOT, OUT_PATH)}`);

    if (failed.length > 0) {
        console.error(`Не удалось обработать ${failed.length}: ${failed.join(', ')}`);
        process.exitCode = 1;
    }
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
