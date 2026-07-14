# LLM Board Game Simulator

LLM 플레이어와 함께하는 로컬 보드게임 시뮬레이터. 외부 LLM API를 연동해 AI가 실제로 전략적 판단을 내리며 게임에 참여한다.

## 지원 게임

- **라스베가스** (Las Vegas) — 주사위를 굴려 카지노에 베팅하는 전략 보드게임

## 지원 예정 게임

- **요트 다이스** (Yacht Dice) — 주사위 5개로 족보를 완성해 점수를 겨루는 보드게임

## 특징

- 사람과 LLM을 자유롭게 조합해 최대 4인 플레이
- Anthropic / OpenAI / Google / NVIDIA NIM 4종 LLM 프로바이더 지원
- 싱글플레이 (로컬) + 멀티플레이 (Socket.io 기반 실시간)
- LLM의 베팅 reasoning을 말풍선으로 실시간 확인

## 기술 스택

- **프레임워크**: Next.js 15 + TypeScript
- **스타일링**: Tailwind CSS
- **멀티플레이**: Socket.io
- **LLM SDK**: @anthropic-ai/sdk, openai, @google/genai

## 설치 및 실행

### 사전 요구사항

- Node.js 18 이상
- npm

### 설치

```bash
git clone https://github.com/your-repo/llm-board-game-simulator.git
cd llm-board-game-simulator
npm install
```

### 환경변수 설정

```bash
cp .env.local.example .env.local
```

`.env.local` 파일을 열고 사용할 LLM 프로바이더의 API 키를 입력한다.

```
# 사용할 프로바이더의 키만 입력하면 됩니다
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
GOOGLE_API_KEY=your_key_here
NVIDIA_API_KEY=your_key_here
```

API 키 없이도 실행 가능하며, 이 경우 AI 플레이어는 **깡통** (랜덤 행동) 모드로 동작한다.

### 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:3000` 접속.

## 멀티플레이

### 같은 네트워크 (로컬 Wi-Fi)

호스트 컴퓨터의 로컬 IP 주소를 게스트에게 공유한다.

```bash
# 호스트 IP 확인 (Windows)
ipconfig

# 호스트 IP 확인 (Mac/Linux)
ifconfig
```

게스트는 브라우저에서 `http://[호스트 IP]:3000` 으로 접속.

### 외부 네트워크 (인터넷)

[ngrok](https://ngrok.com)을 사용하면 포트포워딩 없이 외부 접속이 가능하다.

```bash
# ngrok 설치 후
ngrok http 3000
```

발급된 URL(예: `https://abc123.ngrok.io`)을 게스트에게 공유.

## LLM 프로바이더

| 프로바이더 | 모델 예시 | API 키 |
|-----------|---------|--------|
| Anthropic | claude-sonnet-4-6 | ANTHROPIC_API_KEY |
| OpenAI | gpt-4o | OPENAI_API_KEY |
| Google | gemini-pro | GOOGLE_API_KEY |
| NVIDIA NIM | meta/llama-3.1-70b-instruct | NVIDIA_API_KEY |

NVIDIA NIM은 [build.nvidia.com](https://build.nvidia.com)에서 무료로 API 키를 발급받을 수 있다 (신용카드 불필요).

## 로컬 실행 전용

이 프로젝트는 공개 배포를 목적으로 하지 않는다. 각자 API 키를 `.env.local`에 설정해 로컬에서 실행하는 방식으로 사용한다.
