import * as vscode from 'vscode';

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  template: string; // Markdown content that will be used as the prompt template
  isActive: boolean;
  created: number;
  modified: number;
}

export interface TemplateCategory {
  id: string;
  name: string;
  description: string;
  color?: string;
}

export class TemplateManager {
  private storageUri: vscode.Uri;
  private templates: PromptTemplate[] = [];
  private categories: TemplateCategory[] = [];
  private selectedTemplateId: string | null = null;
  private readonly MAX_TEMPLATES = 10;

  constructor(context: vscode.ExtensionContext) {
    this.storageUri = vscode.Uri.joinPath(context.globalStorageUri, 'prompt-templates');
    this.ensureStorageDirectory();
    this.initializeDefaultCategories();
    this.loadTemplates();
  }

  private async ensureStorageDirectory(): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(this.storageUri);
    } catch (error) {
      // Directory might already exist, ignore error
    }
  }

  private initializeDefaultCategories(): void {
    this.categories = [
      {
        id: 'general',
        name: 'General',
        description: 'General-purpose templates'
      },
      {
        id: 'bug-report',
        name: 'Bug Reports',
        description: 'Templates for bug reporting and issue tracking',
        color: '#ff4444'
      },
      {
        id: 'security',
        name: 'Security',
        description: 'Security vulnerability and audit templates',
        color: '#ff6b35'
      },
      {
        id: 'feature',
        name: 'Feature Requests',
        description: 'Templates for feature requests and enhancements',
        color: '#4CAF50'
      },
      {
        id: 'documentation',
        name: 'Documentation',
        description: 'Documentation and technical writing templates',
        color: '#2196F3'
      }
    ];
  }

  private generateId(): string {
    return `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public async createTemplate(
    name: string,
    description: string,
    category: string,
    template: string
  ): Promise<PromptTemplate> {
    // Check template limit
    if (this.templates.length >= this.MAX_TEMPLATES) {
      throw new Error(`Maximum number of templates (${this.MAX_TEMPLATES}) reached`);
    }

    // Check for duplicate names
    const existingTemplate = this.templates.find(t => t.name === name);
    if (existingTemplate) {
      throw new Error(`Template with name "${name}" already exists`);
    }

    const newTemplate: PromptTemplate = {
      id: this.generateId(),
      name,
      description,
      category,
      template,
      isActive: true,
      created: Date.now(),
      modified: Date.now()
    };

    this.templates.push(newTemplate);
    await this.saveTemplate(newTemplate);
    
    // Auto-select first template if none selected
    if (!this.selectedTemplateId && this.templates.length === 1) {
      this.selectedTemplateId = newTemplate.id;
    }
    
    return newTemplate;
  }

  public async updateTemplate(
    id: string,
    updates: Partial<Omit<PromptTemplate, 'id' | 'created'>>
  ): Promise<PromptTemplate | null> {
    const templateIndex = this.templates.findIndex(t => t.id === id);
    if (templateIndex === -1) {
      return null;
    }

    this.templates[templateIndex] = {
      ...this.templates[templateIndex],
      ...updates,
      modified: Date.now()
    };

    await this.saveTemplate(this.templates[templateIndex]);
    return this.templates[templateIndex];
  }

  public async deleteTemplate(id: string): Promise<boolean> {
    const templateIndex = this.templates.findIndex(t => t.id === id);
    if (templateIndex === -1) {
      return false;
    }

    const template = this.templates[templateIndex];
    this.templates.splice(templateIndex, 1);

    try {
      const templateUri = vscode.Uri.joinPath(this.storageUri, `${template.id}.json`);
      await vscode.workspace.fs.delete(templateUri);
      return true;
    } catch (error) {
      console.error('Error deleting template file:', error);
      return false;
    }
  }

  public getTemplate(id: string): PromptTemplate | null {
    return this.templates.find(t => t.id === id) || null;
  }

  public getAllTemplates(): PromptTemplate[] {
    return [...this.templates];
  }

  public getTemplatesByCategory(categoryId: string): PromptTemplate[] {
    return this.templates.filter(t => t.category === categoryId);
  }

  public getActiveTemplates(): PromptTemplate[] {
    return this.templates.filter(t => t.isActive);
  }

  public getCategories(): TemplateCategory[] {
    return [...this.categories];
  }

  public getDefaultTemplate(): PromptTemplate | null {
    // Return selected template if available and active
    if (this.selectedTemplateId) {
      const selected = this.templates.find(t => t.id === this.selectedTemplateId && t.isActive);
      if (selected) return selected;
    }
    
    // Return the first active template as fallback, or null if none
    return this.templates.find(t => t.isActive) || null;
  }

  public setSelectedTemplate(templateId: string | null): void {
    this.selectedTemplateId = templateId;
  }

  public getSelectedTemplateId(): string | null {
    return this.selectedTemplateId;
  }

  public getMaxTemplates(): number {
    return this.MAX_TEMPLATES;
  }

  public getRemainingSlots(): number {
    return this.MAX_TEMPLATES - this.templates.length;
  }

  private async saveTemplate(template: PromptTemplate): Promise<void> {
    try {
      const templateUri = vscode.Uri.joinPath(this.storageUri, `${template.id}.json`);
      const content = JSON.stringify(template, null, 2);
      await vscode.workspace.fs.writeFile(templateUri, Buffer.from(content, 'utf8'));
    } catch (error) {
      console.error('Error saving template:', error);
    }
  }

  private async loadTemplates(): Promise<void> {
    try {
      const files = await vscode.workspace.fs.readDirectory(this.storageUri);
      const templateFiles = files.filter(([name]) => name.endsWith('.json'));

      for (const [fileName] of templateFiles) {
        try {
          const fileUri = vscode.Uri.joinPath(this.storageUri, fileName);
          const content = await vscode.workspace.fs.readFile(fileUri);
          const template = JSON.parse(content.toString()) as PromptTemplate;
          this.templates.push(template);
        } catch (error) {
          console.error(`Error loading template ${fileName}:`, error);
        }
      }

      // Sort templates by modification date (newest first)
      this.templates.sort((a, b) => b.modified - a.modified);
    } catch (error) {
      console.error('Error loading templates:', error);
    }
  }

  public async createDefaultSecurityTemplate(): Promise<PromptTemplate | null> {
    // Check if security template already exists
    const existing = this.templates.find(t => t.name === 'Security Vulnerability Report');
    if (existing) {
      return null;
    }

    const securityTemplate = `# Security Vulnerability Report

## Priority: Critical

## Identified Vulnerabilities:
**System.Drawing.Common** - Critical severity
- Advisory: GHSA-rxg9-xrhp-64gj
- Impact: Critical security vulnerability identified in ECR image scans

**Newtonsoft.Json** - High severity  
- Advisory: GHSA-5crp-9r3c-p9vr
- Impact: High severity security vulnerability

## Action Items:
- [ ] Upgrade all NuGet packages to latest versions
- [ ] Address System.Drawing.Common vulnerability
- [ ] Address Newtonsoft.Json vulnerability
- [ ] Run security scans to verify fixes
- [ ] Test application functionality

## Additional Package Updates Available:
- Grafana.OpenTelemetry: 1.1.0 → 1.2.0
- Microsoft.EntityFrameworkCore: 9.0.1 → 9.0.7
- Microsoft.FluentUI.AspNetCore.Components: 4.11.8 → 4.12.1
- OpenTelemetry packages: 1.11.1 → 1.12.0
- Npgsql.EntityFrameworkCore.PostgreSQL: 9.0.3 → 9.0.4

## Assigned to: Development Team
## Labels: security, vulnerability, critical

---
*Transform the user's security-related input into this structured format. Extract package names, versions, CVE numbers, and severity levels from the provided information.*`;

    return await this.createTemplate(
      'Security Vulnerability Report',
      'Template for reporting and tracking security vulnerabilities',
      'security',
      securityTemplate
    );
  }

  public async createDefaultBugReportTemplate(): Promise<PromptTemplate | null> {
    // Check if bug report template already exists
    const existing = this.templates.find(t => t.name === 'Bug Report');
    if (existing) {
      return null;
    }

    const bugTemplate = `# Bug Report

## Summary
**Brief description of the issue**

## Environment
- **Browser/Device:** 
- **Version:** 
- **OS:** 

## Steps to Reproduce
1. Step one
2. Step two  
3. Step three

## Expected Behavior
What should happen

## Actual Behavior
What actually happens

## Screenshots/Videos
*Attach any relevant screenshots or videos*

## Additional Context
Any other context about the problem

## Priority: {priority_level}
## Labels: bug, {component}

---
*Structure the user's bug report information into this format, extracting steps, environment details, and expected vs actual behavior.*`;

    return await this.createTemplate(
      'Bug Report',
      'Template for structured bug reporting',
      'bug-report',
      bugTemplate
    );
  }

  public async cleanupDuplicateTemplates(): Promise<number> {
    const seen = new Set<string>();
    const duplicatesToDelete: string[] = [];
    
    // Find duplicates by name
    for (const template of this.templates) {
      if (seen.has(template.name)) {
        duplicatesToDelete.push(template.id);
      } else {
        seen.add(template.name);
      }
    }
    
    // Delete duplicates
    for (const duplicateId of duplicatesToDelete) {
      await this.deleteTemplate(duplicateId);
    }
    
    return duplicatesToDelete.length;
  }

  public async enforceTemplateLimit(): Promise<number> {
    if (this.templates.length <= this.MAX_TEMPLATES) {
      return 0;
    }
    
    // Sort by modified date (oldest first) and delete excess
    const sortedTemplates = [...this.templates].sort((a, b) => a.modified - b.modified);
    const excessCount = this.templates.length - this.MAX_TEMPLATES;
    const templatesToDelete = sortedTemplates.slice(0, excessCount);
    
    for (const template of templatesToDelete) {
      await this.deleteTemplate(template.id);
    }
    
    return excessCount;
  }
}