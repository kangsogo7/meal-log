# 아이폰 홈 화면 위젯(MealWidget) 타깃을 Xcode 프로젝트에 붙임. Mac이 없어서 빌드 서버에서 빌드할 때마다 실행.
# 이미 붙어 있으면 아무것도 안 함. 사용: ruby add_widget_target.rb ios/App/App.xcodeproj
require 'xcodeproj'

path = ARGV[0] || 'ios/App/App.xcodeproj'
project = Xcodeproj::Project.open(path)
if project.targets.any? { |t| t.name == 'MealWidget' }
  puts 'MealWidget 타깃이 이미 있음'
  exit 0
end

app = project.targets.find { |t| t.name == 'App' } or abort 'App 타깃을 찾지 못함'
version = app.build_configurations.first.build_settings['MARKETING_VERSION'] || '1.0'

group = project.main_group.new_group('MealWidget', 'MealWidget')
swift = group.new_reference('MealWidget.swift')
group.new_reference('Info.plist')
group.new_reference('MealWidget.entitlements')

ext = project.new_target(:app_extension, 'MealWidget', :ios, '17.0', nil, :swift)
ext.add_file_references([swift])
ext.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.kangsogo7.mealmanager.widget'
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = 'MealWidget/Info.plist'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_ENTITLEMENTS'] = 'MealWidget/MealWidget.entitlements'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['SWIFT_VERSION'] = '5.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
  s['MARKETING_VERSION'] = version
  s['CURRENT_PROJECT_VERSION'] = '1'
  s['SKIP_INSTALL'] = 'YES'
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
end

# 앱을 빌드하면 위젯도 같이 빌드해서 앱 안(PlugIns)에 넣음
app.add_dependency(ext)
embed = app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
file = embed.add_file_reference(ext.product_reference, true)
file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
# 스크립트 단계보다 앞에 두어야 빌드 순환 오류가 안 남
app.build_phases.delete(embed)
app.build_phases.insert(app.build_phases.index(app.resources_build_phase) + 1, embed)

project.save
puts "MealWidget 타깃 추가 (버전 #{version})"
