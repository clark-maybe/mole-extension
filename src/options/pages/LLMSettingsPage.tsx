/**
 * LLM 设置页面
 * 配置 AI API 连接信息（Endpoint / API Key / Model）
 * 首次未配置时展示引导浮层
 */

import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Modal, Typography, App } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { getAISettings, saveAISettings } from '../../ai/llm-client';

const { Title, Text, Paragraph } = Typography;

/** 检查设置是否已配置（至少有 endpoint 和 apiKey） */
const isConfigured = (s: { endpoint?: string; apiKey?: string }): boolean =>
  !!(s.endpoint?.trim() && s.apiKey?.trim());

export function LLMSettingsPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [setupForm] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [loaded, setLoaded] = useState(false);

  /* 加载已保存的设置，判断是否需要引导 */
  useEffect(() => {
    const load = async () => {
      const settings = await getAISettings();
      form.setFieldsValue({
        endpoint: settings.endpoint || '',
        apiKey: settings.apiKey || '',
        model: settings.model || 'gpt-5.4',
      });
      if (!isConfigured(settings)) {
        setupForm.setFieldsValue({
          endpoint: '',
          apiKey: '',
          model: 'gpt-5.4',
        });
        setShowSetup(true);
      }
      setLoaded(true);
    };
    void load();
  }, [form, setupForm]);

  /* 保存设置（通用） */
  const doSave = async (values: Record<string, any>, fromSetup = false) => {
    setSaving(true);
    try {
      await saveAISettings({
        endpoint: String(values.endpoint || '').trim(),
        apiKey: String(values.apiKey || '').trim(),
        model: String(values.model || 'gpt-5.4').trim(),
      });
      if (fromSetup) {
        setShowSetup(false);
        /* 同步到主表单 */
        form.setFieldsValue({
          endpoint: values.endpoint,
          apiKey: values.apiKey,
          model: values.model || 'gpt-5.4',
        });
      }
      void message.success('设置已保存，Mole 准备就绪');
    } catch (err: any) {
      void message.error(err?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  /* 主表单保存 */
  const handleSave = async () => {
    const values = form.getFieldsValue();
    await doSave(values);
  };

  /* 引导浮层保存 */
  const handleSetupSave = async () => {
    try {
      const values = await setupForm.validateFields();
      await doSave(values, true);
    } catch {
      /* 表单校验不通过，忽略 */
    }
  };

  if (!loaded) return null;

  return (
    <>
      <Title level={4} style={{ marginTop: 0, marginBottom: 20 }}>LLM 设置</Title>
      <Card>
        <Paragraph type="secondary" style={{ marginBottom: 24 }}>
          Mole 通过 OpenAI 兼容接口与大语言模型通信。配置你的 API 地址、密钥和模型名称后，
          即可在任意网页上使用 AI 助手。
        </Paragraph>
        <Form form={form} layout="vertical" style={{ maxWidth: 480 }}>
          <Form.Item
            label="Endpoint URL"
            name="endpoint"
            extra="API 服务地址，如 https://api.openai.com/v1"
          >
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item
            label="API Key"
            name="apiKey"
            extra="你的 API 密钥，仅存储在本地浏览器中"
          >
            <Input.Password placeholder="sk-..." />
          </Form.Item>
          <Form.Item
            label="Model"
            name="model"
            extra={
              <span>
                推荐 <Text strong style={{ fontSize: 12 }}>gpt-5.4</Text>（最新旗舰）、
                <Text style={{ fontSize: 12 }}>gpt-5.2</Text>（高性价比）
              </span>
            }
          >
            <Input placeholder="gpt-5.4" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" loading={saving} onClick={() => void handleSave()}>
              保存设置
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* 首次配置引导浮层 */}
      <Modal
        open={showSetup}
        closable={false}
        maskClosable={false}
        footer={null}
        width={520}
        centered
        styles={{
          body: { padding: '36px 32px 28px' },
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img
            src={chrome.runtime?.getURL?.('logo.png') || '/logo.png'}
            alt="Mole"
            style={{ width: 64, height: 64, marginBottom: 12 }}
          />
          <Title level={4} style={{ marginBottom: 4, fontWeight: 600 }}>欢迎使用 Mole</Title>
          <Paragraph type="secondary" style={{ fontSize: 14, marginBottom: 0, lineHeight: 1.6 }}>
            只需三步，即可让 AI 助手在你的浏览器中工作。
            <br />
            配置完成后，在任意网页按 <Text keyboard>⌘ M</Text> 唤起 Mole。
          </Paragraph>
        </div>

        <Form
          form={setupForm}
          layout="vertical"
          requiredMark={false}
        >
          <Form.Item
            label={<span style={{ fontWeight: 500 }}>API 地址</span>}
            name="endpoint"
            rules={[{ required: true, message: '请填写 API Endpoint' }]}
            extra="兼容 OpenAI 格式的接口地址"
          >
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item
            label={<span style={{ fontWeight: 500 }}>API 密钥</span>}
            name="apiKey"
            rules={[{ required: true, message: '请填写 API Key' }]}
            extra="密钥仅加密存储在本地，不会上传至任何服务器"
          >
            <Input.Password placeholder="sk-..." />
          </Form.Item>
          <Form.Item
            label={<span style={{ fontWeight: 500 }}>模型</span>}
            name="model"
          >
            <Input placeholder="gpt-5.4" />
          </Form.Item>

          <Button
            type="primary"
            block
            loading={saving}
            icon={<CheckCircleOutlined />}
            onClick={() => void handleSetupSave()}
            style={{ height: 40, fontWeight: 500, borderRadius: 8 }}
          >
            开始使用 Mole
          </Button>
        </Form>
      </Modal>
    </>
  );
}
