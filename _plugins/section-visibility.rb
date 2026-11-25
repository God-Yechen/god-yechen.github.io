# Private categories are removed before generators build navigation and archives.
Jekyll::Hooks.register :site, :post_read do |site|
  statuses = site.data['section_visibility'] || {}
  site.data['category_sections'] = (site.data['category_sections'] || []).reject { |name| statuses['category:' + name] == 'private' }
end
