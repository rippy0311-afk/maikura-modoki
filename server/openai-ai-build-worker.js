const AI_BLUEPRINT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'primitives', 'blocks'],
  properties: {
    label: { type: 'string', maxLength: 40 },
    primitives: {
      type: 'array',
      maxItems: 80,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'x', 'y', 'z', 'sx', 'sy', 'sz', 'radius', 'material'],
        properties: {
          type: { type: 'string', enum: ['box', 'sphere', 'ellipsoid', 'cylinder'] },
          x: { type: 'integer', minimum: -28, maximum: 28 },
          y: { type: 'integer', minimum: 0, maximum: 44 },
          z: { type: 'integer', minimum: -28, maximum: 28 },
          sx: { type: 'integer', minimum: 0, maximum: 44 },
          sy: { type: 'integer', minimum: 0, maximum: 44 },
          sz: { type: 'integer', minimum: 0, maximum: 44 },
          radius: { type: 'integer', minimum: 1, maximum: 28 },
          material: { type: 'string', maxLength: 48 },
        },
      },
    },
    blocks: {
      type: 'array',
      maxItems: 6000,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['x', 'y', 'z', 'material'],
        properties: {
          x: { type: 'integer', minimum: -28, maximum: 28 },
          y: { type: 'integer', minimum: 0, maximum: 44 },
          z: { type: 'integer', minimum: -28, maximum: 28 },
          material: { type: 'string', maxLength: 48 },
        },
      },
    },
  },
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function extractJsonText(data) {
  if (typeof data.output_text === 'string') return data.output_text;
  const message = data.output?.find((item) => item.type === 'message');
  const text = message?.content?.find((item) => item.type === 'output_text');
  return text?.text || '{}';
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request.headers.get('Origin'));
    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers });
    }
    if (!env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: 'OPENAI_API_KEY is not configured' }), { status: 500, headers });
    }

    const body = await request.json().catch(() => ({}));
    const prompt = String(body.prompt || '').slice(0, 500);
    const materials = Array.isArray(body.context?.materials) ? body.context.materials.slice(0, 120) : [];

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || 'gpt-5.5',
        input: [
          {
            role: 'system',
            content:
              'You design voxel builds for a Minecraft-like browser game. Return only a compact JSON blueprint. Use primitives first, raw blocks only for details. Coordinates are relative to origin; y starts at ground. Keep the build recognizable, safe, and under limits.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              request: prompt,
              available_materials: materials,
              blueprint_rules: {
                primitive_types: ['box', 'sphere', 'ellipsoid', 'cylinder'],
                max_primitives: 80,
                max_blocks: 6000,
                coordinate_range: { x: [-28, 28], y: [0, 44], z: [-28, 28] },
              },
            }),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'ai_voxel_blueprint',
            strict: true,
            schema: AI_BLUEPRINT_SCHEMA,
          },
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return new Response(JSON.stringify({ error }), { status: response.status, headers });
    }

    const data = await response.json();
    const jsonText = extractJsonText(data);
    return new Response(jsonText, { headers });
  },
};
