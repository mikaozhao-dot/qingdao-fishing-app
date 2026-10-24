const sandboxPhone = /^16600000\d{3}$/;

export function createSmsAdapter(config, security) {
  return Object.freeze({
    async sendVerificationCode(phone) {
      if (config.nodeEnv === 'production' || !config.demoSandboxEnabled) {
        const error = new Error('短信服务尚未接入');
        error.statusCode = 503;
        throw error;
      }
      if (!sandboxPhone.test(phone)) {
        const error = new Error('沙盒仅支持 16600000 开头的测试手机号');
        error.statusCode = 400;
        throw error;
      }
      const code = config.demoSmsCode || security.newSmsCode();
      return { code, sandboxCode: config.nodeEnv === 'production' ? undefined : code };
    },
  });
}
