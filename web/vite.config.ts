import { execSync } from 'node:child_process'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * 화면에 박아 넣을 빌드 표시.
 *
 * "서버에서는 화면이 바뀌지 않네" 를 눈으로 확인할 수 있어야 합니다.
 * GitHub Pages 는 index.html 에 max-age=600 을 걸기 때문에 브라우저가 옛
 * HTML 을 물고 있으면 새 번들을 못 받습니다. 그때 이 값이 화면에 그대로
 * 남아 있으면 "캐시다" 라고 바로 알 수 있습니다.
 *
 * GitHub Actions 에서는 GITHUB_SHA 가 들어옵니다. 로컬에서는 git 에 묻습니다.
 */
function buildId(): string {
  const sha = process.env.GITHUB_SHA
  if (sha) return sha.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'dev'
  }
}

// GitHub Pages 서브경로 배포. 저장소 이름이 다르면 base 를 함께 바꿔야
// 배포된 페이지가 흰 화면이 되지 않습니다.
export default defineConfig({
  plugins: [react()],
  base: '/ticket-dashboard/',
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
    __BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 시간대를 고정합니다. 주간 구간·기한 초과 판정은 전부 로컬 시각 기준이고
    // (한국 팀이 쓰는 화면이므로 그게 맞습니다), 고정하지 않으면 UTC 인 CI 와
    // KST 인 개발 기기에서 결과가 갈립니다.
    env: { TZ: 'Asia/Seoul' },
  },
})
