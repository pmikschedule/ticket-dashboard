/**
 * 설정 — `.env` 와 환경변수.
 *
 * dotenv 를 쓰지 않습니다. 필요한 건 `KEY=VALUE` 한 줄짜리 파싱뿐이고,
 * 이 도구는 의존성이 적을수록 오프라인 환경에서 살아남습니다.
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '..')

function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

const fileEnv = loadEnvFile(resolve(ROOT, '.env'))

/** 환경변수가 `.env` 를 이깁니다 — CI·수동 실행에서 한 번만 덮어쓸 수 있게 */
function env(key: string, fallback = ''): string {
  return (process.env[key] ?? fileEnv[key] ?? fallback).trim()
}

export interface Config {
  deskUrl: string
  chromeProfile: string
  /** 자동 추출이 실패했을 때 쓰는 수동 쿠키 */
  cfAuthorization: string
  supabaseUrl: string
  supabaseAnonKey: string
  supabaseEmail: string
  supabasePassword: string
  author: string
  subtitle: string
  team: string
  snapshotDir: string
  outDir: string
  /**
   * 태스크 맵. **`data/` 가 아니라 `config/` 입니다** — data 는 gitignore 라
   * 잃으면 복구가 안 되는데, 이 파일은 사람이 분류한 결과라 다시 못 뽑습니다.
   */
  taskmapPath: string
  /** 태스크 맵 UI 포트. 127.0.0.1 에만 바인딩합니다 */
  uiPort: number
}

export function loadConfig(): Config {
  return {
    deskUrl: env('DESK_URL', 'https://desk.saebom.me'),
    chromeProfile: env('CHROME_PROFILE'),
    cfAuthorization: env('CF_AUTHORIZATION'),
    supabaseUrl: env('SUPABASE_URL'),
    supabaseAnonKey: env('SUPABASE_ANON_KEY'),
    supabaseEmail: env('SUPABASE_EMAIL'),
    supabasePassword: env('SUPABASE_PASSWORD'),
    author: env('REPORT_AUTHOR', 'Steven'),
    subtitle: env('REPORT_SUBTITLE', 'WEB / POVAS 운영·개발'),
    team: env('REPORT_TEAM', 'Compliance Team'),
    snapshotDir: resolve(ROOT, env('SNAPSHOT_DIR', 'data/snapshots')),
    outDir: resolve(ROOT, env('OUT_DIR', 'out')),
    taskmapPath: resolve(ROOT, env('TASKMAP', 'config/taskmap.json')),
    uiPort: Number(env('UI_PORT', '4173')),
  }
}
