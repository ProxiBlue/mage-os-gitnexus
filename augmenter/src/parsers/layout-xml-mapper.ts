import { parseLayoutXml } from './layout-xml.js';
import { NodeIdResolver } from '../resolvers/node-id.js';
import { TemplatePathResolver } from '../resolvers/template-path.js';
import { parsePsr4Map } from '../resolvers/psr4-map.js';
import { AugmentEdge } from '../writer/lbug-writer.js';

export interface LayoutMappingResult {
  edges: AugmentEdge[];
  stats: {
    resolved: number;
    skippedNoClass: number;
    skippedNoTemplate: number;
    unresolvedClasses: string[];
    unresolvedTemplates: string[];
  };
}

export async function mapLayoutXmlEdges(projectRoot: string): Promise<LayoutMappingResult> {
  const psr4Map = await parsePsr4Map(projectRoot);
  const nodeIdResolver = new NodeIdResolver(psr4Map, projectRoot);
  const templatePathResolver = new TemplatePathResolver(psr4Map, projectRoot);

  const { blockTemplates } = await parseLayoutXml(projectRoot);

  const edges: AugmentEdge[] = [];
  let resolved = 0;
  let skippedNoClass = 0;
  let skippedNoTemplate = 0;
  const unresolvedClasses: string[] = [];
  const unresolvedTemplates: string[] = [];

  for (const bt of blockTemplates) {
    const classNode = nodeIdResolver.resolve(bt.blockClass);
    if (!classNode) {
      skippedNoClass++;
      unresolvedClasses.push(bt.blockClass);
      continue;
    }

    const templatePath = templatePathResolver.resolve(bt.templateRef, bt.area);
    if (!templatePath) {
      skippedNoTemplate++;
      unresolvedTemplates.push(bt.templateRef);
      continue;
    }

    edges.push({
      sourceId: `File:${classNode.filePath}`,
      targetId: `File:${templatePath}`,
      type: 'CALLS',
      confidence: 1.0,
      reason: 'magento:layout:block-template',
    });
    resolved++;
  }

  return {
    edges,
    stats: {
      resolved,
      skippedNoClass,
      skippedNoTemplate,
      unresolvedClasses,
      unresolvedTemplates,
    },
  };
}
