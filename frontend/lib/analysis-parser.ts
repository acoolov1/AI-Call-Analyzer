/**
 * Parse analysis text to extract structured sections
 */
export interface ParsedAnalysis {
  summary: string;
  actionItems: string;
  sentiment: string;
  urgentTopics: string;
}

export function parseAnalysis(analysisText: string | undefined | null): ParsedAnalysis {
  const sections: ParsedAnalysis = {
    summary: '',
    actionItems: '',
    sentiment: '',
    urgentTopics: ''
  };
  
  if (!analysisText) return sections;
  
  // Split by numbered sections (1., 2., 3., etc.) or bold headers
  const lines = analysisText.split('\n');
  let currentSection: keyof ParsedAnalysis | null = null;
  let currentContent: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Check for section headers - be more specific
    if (/^2\.\s*\*\*?Summary\*\*?/i.test(line) || /^2\.\s*Summary/i.test(line)) {
      // Save previous section if exists
      if (currentSection && currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = 'summary';
      currentContent = [];
      continue;
    }
    
    if (/^3\.\s*\*\*?Action\s+Items\*\*?/i.test(line) || /^3\.\s*Action\s+Items/i.test(line)) {
      if (currentSection && currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = 'actionItems';
      currentContent = [];
      continue;
    }
    
    if (/^4\.\s*\*\*?Sentiment\*\*?/i.test(line) || /^4\.\s*Sentiment/i.test(line)) {
      if (currentSection && currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = 'sentiment';
      currentContent = [];
      continue;
    }
    
    if (/^5\.\s*\*\*?Urgent\s+Topics\*\*?/i.test(line) || /^5\.\s*Urgent\s+Topics/i.test(line)) {
      if (currentSection && currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = 'urgentTopics';
      currentContent = [];
      continue;
    }
    
    // If we're in a section and this line isn't a new section header, add to content
    if (currentSection && line && !/^\d+\./.test(line)) {
      // Remove markdown formatting
      const cleanLine = line.replace(/\*\*/g, '').replace(/^[-*•]\s*/, '').trim();
      if (cleanLine) {
        currentContent.push(cleanLine);
      }
    }
  }
  
  // Save the last section
  if (currentSection && currentContent.length > 0) {
    sections[currentSection] = currentContent.join('\n').trim();
  }
  
  // Clean up sections - remove markdown and extra whitespace
  Object.keys(sections).forEach(key => {
    sections[key as keyof ParsedAnalysis] = sections[key as keyof ParsedAnalysis]
      .replace(/\*\*/g, '')
      .replace(/^[-*•]\s*/gm, '')
      .trim();
  });
  
  // Fallback: if still empty, try regex approach
  if (!sections.summary && !sections.actionItems && !sections.sentiment) {
    // Try regex patterns as fallback
    const summaryMatch = analysisText.match(/2\.\s*\*\*?Summary\*\*?[:\s]*\n?(.*?)(?=\n\s*3\.|$)/is);
    if (summaryMatch) {
      sections.summary = summaryMatch[1].trim().replace(/\*\*/g, '');
    }
    
    const actionItemsMatch = analysisText.match(/3\.\s*\*\*?Action\s+Items\*\*?[:\s]*\n?(.*?)(?=\n\s*4\.|$)/is);
    if (actionItemsMatch) {
      sections.actionItems = actionItemsMatch[1].trim().replace(/\*\*/g, '');
    }
    
    const sentimentMatch = analysisText.match(/4\.\s*\*\*?Sentiment\*\*?[:\s]*\n?(.*?)(?=\n\s*5\.|$)/is);
    if (sentimentMatch) {
      sections.sentiment = sentimentMatch[1].trim().replace(/\*\*/g, '');
    }
    
    const urgentMatch = analysisText.match(/5\.\s*\*\*?Urgent\s+Topics\*\*?[:\s]*\n?(.*?)$/is);
    if (urgentMatch) {
      sections.urgentTopics = urgentMatch[1].trim().replace(/\*\*/g, '');
    }
  }
  
  return sections;
}

/**
 * Format sentiment with status badge class
 */
export function getSentimentBadge(sentimentText: string | undefined | null): { class: string; text: string } {
  if (!sentimentText) {
    return { class: 'status-neutral', text: 'Unknown' };
  }
  
  const sentiment = sentimentText.toLowerCase().trim();
  
  // Check for urgent first - should be red
  if (/urgent/i.test(sentiment)) {
    return { class: 'status-negative', text: 'Urgent' };
  } else if (/positive|happy|good|great|excellent|satisfied|pleased/i.test(sentiment)) {
    return { class: 'status-positive', text: 'Positive' };
  } else if (/negative|sad|bad|poor|angry|frustrated|disappointed|unhappy/i.test(sentiment)) {
    return { class: 'status-negative', text: 'Negative' };
  } else if (/neutral|normal|okay|ok|average|moderate/i.test(sentiment)) {
    return { class: 'status-neutral', text: 'Neutral' };
  } else {
    // Default to neutral if unclear
    return { 
      class: 'status-neutral', 
      text: sentimentText.charAt(0).toUpperCase() + sentimentText.slice(1).toLowerCase() 
    };
  }
}

/**
 * Create preview text
 */
export function createPreview(text: string | undefined | null, maxLength: number = 50): string {
  if (!text) return 'No content';
  const cleanText = text.replace(/\n/g, ' ').trim();
  if (cleanText.length <= maxLength) return cleanText;
  return cleanText.substring(0, maxLength) + '...';
}

/**
 * Check if urgent topics actually exist (not "None" or empty)
 */
export function hasUrgentTopics(urgentTopics: string | undefined | null): boolean {
  if (!urgentTopics) return false;
  return urgentTopics.toLowerCase().trim() !== 'none' && urgentTopics.trim() !== '';
}

