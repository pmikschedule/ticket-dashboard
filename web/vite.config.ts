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
  },
})
