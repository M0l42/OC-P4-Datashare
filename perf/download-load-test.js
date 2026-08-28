// QA-06: load test on the real hot path for a recipient — GET /d/:token,
// which does one DB read plus a local HMAC signature (no MinIO round trip).
// Run once at 1 replica and once at 3 (see `make perf-download n=1|3`), and
// compare the two JSON summaries. Not a synthetic benchmark: this is the
// exact request a recipient's browser sends when opening a download link.
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const TOKEN = __ENV.TOKEN;

if (!TOKEN) {
  throw new Error('TOKEN env var required — run perf/seed-download-token.sh first');
}

export const options = {
  vus: 20,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/api/d/${TOKEN}`);
  check(res, { 'status is 200': (r) => r.status === 200 });
}
