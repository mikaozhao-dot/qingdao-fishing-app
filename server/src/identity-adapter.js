import { verifyChineseIdentityNumber } from './security.js';

export function createIdentityAdapter(config) {
  return Object.freeze({
    async verify({ identityNumber }) {
      if (config.nodeEnv === 'production' || !config.demoSandboxEnabled) {
        const error = new Error('实名核验服务尚未接入');
        error.statusCode = 503;
        throw error;
      }
      if (!verifyChineseIdentityNumber(identityNumber)) {
        const error = new Error('身份证号码格式或校验位不正确');
        error.statusCode = 400;
        throw error;
      }
      if (identityNumber.slice(0, 6) !== '990000') {
        const error = new Error('实名沙盒仅接受 990000 测试号段');
        error.statusCode = 400;
        throw error;
      }
      if (identityNumber.slice(14, 17) === '999') {
        return { status: 'rejected', reason: '沙盒拒绝样例：请检查证件资料后重新提交' };
      }
      return { status: 'verified', reason: null };
    },
  });
}
