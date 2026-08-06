import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// GitHub Pages 서브경로 배포. 저장소 이름이 다르면 base 를 함께 바꿔야
// 배포된 페이지가 흰 화면이 되지 않습니다.
export default defineConfig({
  plugins: [react()],
  base: '/ticket-dashboard/',
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 시간대를 고정합니다. 주간 구간·기한 초과 판정은 전부 로컬 시각 기준이고
    // (한국 팀이 쓰는 화면이므로 그게 맞습니다), 고정하지 않으면 UTC 인 CI 와
    // KST 인 개발 기기에서 결과가 갈립니다.
    env: { TZ: 'Asia/Seoul' },
  },
})
