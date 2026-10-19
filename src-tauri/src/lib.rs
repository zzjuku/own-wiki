mod assets;
mod categories;
mod error;
mod fsutil;
mod groups;
mod index;
mod infobox;
mod pages;
mod projects;
mod relink;
mod settings;
mod templating;
mod textimages;
mod tree;
mod wikilinks;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{Manager, State};

use error::{AppError, AppResult};
use index::ProjectIndex;
use infobox::{Infobox, Template};
use pages::Page;
use projects::ProjectInfo;
use relink::{Backlink, IncomingField, LinkCount, Preview, RenameResult};
use templating::ApplyResult;
use settings::Settings;
use tree::{GroupInfo, PageInfo, Tree};
use wikilinks::{Heading, norm};

struct AppState {
    config_dir: PathBuf,
    settings: Mutex<Settings>,
    /// Link index of the open project (one at a time).
    index: Mutex<Option<ProjectIndex>>,
}

impl AppState {
    fn library(&self) -> AppResult<PathBuf> {
        settings::library_dir(&self.settings.lock().unwrap())
    }

    /// Runs `f` with the project's link index, loading it first if another
    /// project's (or none) is loaded. With `refresh`, files changed on disk
    /// are re-read first.
    fn with_index<R>(
        &self,
        project: &str,
        refresh: bool,
        f: impl FnOnce(&std::path::Path, &mut ProjectIndex) -> AppResult<R>,
    ) -> AppResult<R> {
        let library = self.library()?;
        let dir = projects::project_dir(&library, project)?;
        let mut guard = self.index.lock().unwrap();
        match guard.as_mut() {
            Some(idx) if idx.dir == dir => {
                if refresh {
                    idx.refresh(&[])?;
                }
            }
            _ => *guard = Some(ProjectIndex::open(&dir)?),
        }
        f(&library, guard.as_mut().unwrap())
    }

    fn forget_index(&self) {
        if let Some(mut idx) = self.index.lock().unwrap().take() {
            idx.save_cache(true);
        }
    }
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn set_library_path(state: State<AppState>, path: String) -> AppResult<Settings> {
    if !PathBuf::from(&path).is_dir() {
        return Err(AppError::NotFound(format!("Folder not found: {path}")));
    }
    state.forget_index();
    let mut current = state.settings.lock().unwrap();
    let mut next = current.clone();
    next.library_path = Some(path);
    settings::save(&state.config_dir, &next)?;
    *current = next.clone();
    Ok(next)
}

#[tauri::command]
fn list_projects(state: State<AppState>) -> AppResult<Vec<ProjectInfo>> {
    projects::list_projects(&state.library()?)
}

#[tauri::command]
fn create_project(state: State<AppState>, name: String) -> AppResult<ProjectInfo> {
    projects::create_project(&state.library()?, &name)
}

#[tauri::command]
fn rename_project(state: State<AppState>, id: String, name: String) -> AppResult<ProjectInfo> {
    state.forget_index();
    projects::rename_project(&state.library()?, &id, &name)
}

#[tauri::command]
fn delete_project(state: State<AppState>, id: String) -> AppResult<()> {
    state.forget_index();
    projects::delete_project(&state.library()?, &id)
}

// Commands that use the link index run off the main thread (`async`), so a
// big project being indexed doesn't freeze the window.

#[tauri::command(async)]
fn get_tree(state: State<'_, AppState>, project: String) -> AppResult<Tree> {
    state.with_index(&project, true, |_, idx| {
        Ok(Tree { groups: idx.groups.clone(), pages: idx.page_infos(), main_page: projects::main_page(&idx.dir) })
    })
}

#[tauri::command(async)]
fn create_page(
    state: State<'_, AppState>,
    project: String,
    group: String,
    title: String,
    allow_long: bool,
    template: Option<String>,
) -> AppResult<PageInfo> {
    state.with_index(&project, true, |library, idx| {
        let template = match template {
            Some(id) => Some(
                projects::templates(&idx.dir)?
                    .into_iter()
                    .find(|t| t.id == id)
                    .ok_or_else(|| AppError::NotFound("That template doesn't exist any more.".into()))?,
            ),
            None => None,
        };
        let info =
            pages::create_page(library, &project, &group, &title, allow_long, &idx.page_infos(), template.as_ref())?;
        idx.refresh(&[&info.id])?;
        Ok(info)
    })
}

#[tauri::command]
fn read_page(state: State<AppState>, project: String, id: String) -> AppResult<Page> {
    pages::read_page(&state.library()?, &project, &id)
}

#[tauri::command(async)]
fn save_page(state: State<'_, AppState>, project: String, id: String, body: String) -> AppResult<()> {
    state.with_index(&project, false, |library, idx| {
        pages::save_page(library, &project, &id, &body)?;
        idx.reload_page(&id);
        Ok(())
    })
}

#[tauri::command(async)]
fn save_infobox(
    state: State<'_, AppState>,
    project: String,
    id: String,
    infobox: Option<Infobox>,
) -> AppResult<()> {
    state.with_index(&project, false, |library, idx| {
        pages::save_infobox(library, &project, &id, infobox.as_ref())?;
        idx.reload_page(&id);
        Ok(())
    })
}

/// Templates of any project (also another one, for copying templates).
#[tauri::command]
fn get_templates(state: State<AppState>, project: String) -> AppResult<Vec<Template>> {
    projects::templates(&projects::project_dir(&state.library()?, &project)?)
}

#[tauri::command(async)]
fn set_templates(state: State<'_, AppState>, project: String, templates: Vec<Template>) -> AppResult<()> {
    state.with_index(&project, false, |_, idx| projects::set_templates(&idx.dir, &templates))
}

#[tauri::command(async)]
fn template_pages(state: State<'_, AppState>, project: String, id: String) -> AppResult<Vec<PageInfo>> {
    state.with_index(&project, true, |_, idx| Ok(templating::template_pages(idx, &id)))
}

#[tauri::command(async)]
fn apply_template(
    state: State<'_, AppState>,
    project: String,
    id: String,
    pages: Option<Vec<String>>,
    dry_run: bool,
) -> AppResult<ApplyResult> {
    state.with_index(&project, true, |library, idx| {
        templating::apply(library, &project, idx, &id, pages.as_deref(), dry_run)
    })
}

#[tauri::command(async)]
fn incoming_fields(state: State<'_, AppState>, project: String, id: String) -> AppResult<Vec<IncomingField>> {
    state.with_index(&project, false, |_, idx| relink::incoming_fields(idx, &id))
}

/// Copies an image file into the project. `svg`: SVG is allowed (page text, galleries).
#[tauri::command(async)]
fn import_image(state: State<'_, AppState>, project: String, path: String, svg: bool) -> AppResult<String> {
    assets::import_image(&state.library()?, &project, std::path::Path::new(&path), svg)
}

/// Stores a pasted image. The bytes are the request body; `project` and
/// `name` come as percent-encoded headers.
#[tauri::command(async)]
fn import_image_data(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> AppResult<String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err(AppError::Invalid("No image data.".into()));
    };
    let header = |k: &str| {
        request.headers().get(k).and_then(|v| v.to_str().ok()).map(assets::percent_decode).unwrap_or_default()
    };
    assets::import_image_data(&state.library()?, &header("project"), &header("name"), data, true)
}

#[tauri::command]
fn get_project_settings(state: State<AppState>, project: String) -> AppResult<projects::ProjectSettings> {
    projects::settings(&projects::project_dir(&state.library()?, &project)?)
}

#[tauri::command]
fn set_project_settings(state: State<AppState>, project: String, settings: projects::ProjectSettings) -> AppResult<()> {
    projects::set_settings(&projects::project_dir(&state.library()?, &project)?, &settings)
}

#[tauri::command]
fn get_image_frame(state: State<AppState>, project: String) -> AppResult<projects::Frame> {
    projects::image_frame(&projects::project_dir(&state.library()?, &project)?)
}

#[tauri::command]
fn set_image_frame(state: State<AppState>, project: String, frame: projects::Frame) -> AppResult<()> {
    projects::set_image_frame(&projects::project_dir(&state.library()?, &project)?, frame)
}

#[tauri::command(async)]
fn rename_page(
    state: State<'_, AppState>,
    project: String,
    id: String,
    title: String,
    allow_long: bool,
    keep_alias: bool,
) -> AppResult<RenameResult> {
    state.with_index(&project, true, |library, idx| {
        relink::rename_with_links(library, &project, idx, &id, &title, allow_long, keep_alias)
    })
}

#[tauri::command(async)]
fn move_page(
    state: State<'_, AppState>,
    project: String,
    id: String,
    target: String,
    allow_long: bool,
) -> AppResult<PageInfo> {
    state.with_index(&project, true, |library, idx| {
        let info = pages::move_page(library, &project, &id, &target, allow_long, &idx.page_infos())?;
        idx.refresh(&[])?;
        Ok(info)
    })
}

#[tauri::command(async)]
fn delete_page(state: State<'_, AppState>, project: String, id: String) -> AppResult<()> {
    state.with_index(&project, true, |library, idx| {
        let title = idx.pages.get(&id).map(|e| e.title.clone());
        pages::delete_page(library, &project, &id)?;
        // Deleting the main page leaves the project without one.
        if let (Some(t), Some(m)) = (title, projects::main_page(&idx.dir)) {
            if norm(&t) == norm(&m) {
                projects::set_main_page(&idx.dir, None)?;
            }
        }
        idx.refresh(&[])
    })
}

#[tauri::command(async)]
fn set_aliases(
    state: State<'_, AppState>,
    project: String,
    id: String,
    aliases: Vec<String>,
) -> AppResult<PageInfo> {
    state.with_index(&project, true, |library, idx| {
        let info = pages::set_aliases(library, &project, &id, &aliases, &idx.page_infos())?;
        idx.reload_page(&id);
        Ok(info)
    })
}

#[tauri::command(async)]
fn set_main_page(state: State<'_, AppState>, project: String, title: Option<String>) -> AppResult<()> {
    state.with_index(&project, false, |_, idx| projects::set_main_page(&idx.dir, title.as_deref()))
}

#[tauri::command(async)]
fn page_sections(state: State<'_, AppState>, project: String, id: String) -> AppResult<Vec<Heading>> {
    state.with_index(&project, false, |_, idx| relink::sections(idx, &id))
}

#[tauri::command(async)]
fn link_preview(
    state: State<'_, AppState>,
    project: String,
    id: String,
    section: Option<String>,
) -> AppResult<Preview> {
    state.with_index(&project, false, |library, idx| {
        relink::preview(library, &project, idx, &id, section.as_deref())
    })
}

#[tauri::command(async)]
fn backlinks(
    state: State<'_, AppState>,
    project: String,
    id: String,
    context: bool,
) -> AppResult<Vec<Backlink>> {
    state.with_index(&project, false, |library, idx| relink::backlinks(library, &project, idx, &id, context))
}

#[tauri::command(async)]
fn embedded_in(state: State<'_, AppState>, project: String, id: String) -> AppResult<Vec<relink::EmbedHost>> {
    state.with_index(&project, false, |_, idx| relink::embedded_in(idx, &id))
}

#[tauri::command(async)]
fn embed_sources(state: State<'_, AppState>, project: String, ids: Vec<String>) -> AppResult<Vec<relink::EmbedSource>> {
    state.with_index(&project, false, |library, idx| relink::embed_sources(library, &project, idx, &ids))
}

#[tauri::command(async)]
fn link_count(state: State<'_, AppState>, project: String, name: String) -> AppResult<LinkCount> {
    state.with_index(&project, false, |_, idx| Ok(relink::link_count(idx, &name)))
}

#[tauri::command(async)]
fn create_group(
    state: State<'_, AppState>,
    project: String,
    parent: String,
    name: String,
    allow_long: bool,
) -> AppResult<GroupInfo> {
    state.with_index(&project, false, |library, idx| {
        let info = groups::create_group(library, &project, &parent, &name, allow_long)?;
        idx.refresh(&[])?;
        Ok(info)
    })
}

#[tauri::command(async)]
fn rename_group(
    state: State<'_, AppState>,
    project: String,
    id: String,
    name: String,
    allow_long: bool,
) -> AppResult<GroupInfo> {
    state.with_index(&project, false, |library, idx| {
        let info = groups::rename_group(library, &project, &id, &name, allow_long)?;
        idx.refresh(&[])?;
        Ok(info)
    })
}

#[tauri::command(async)]
fn move_group(
    state: State<'_, AppState>,
    project: String,
    id: String,
    target: String,
    allow_long: bool,
) -> AppResult<GroupInfo> {
    state.with_index(&project, false, |library, idx| {
        let info = groups::move_group(library, &project, &id, &target, allow_long)?;
        idx.refresh(&[])?;
        Ok(info)
    })
}

#[tauri::command(async)]
fn delete_group(state: State<'_, AppState>, project: String, id: String) -> AppResult<()> {
    state.with_index(&project, false, |library, idx| {
        groups::delete_group(library, &project, &id)?;
        idx.refresh(&[])
    })
}

// ---- categories ----

#[tauri::command(async)]
fn list_categories(state: State<'_, AppState>, project: String) -> AppResult<Vec<categories::CategoryInfo>> {
    state.with_index(&project, true, |_, idx| categories::list(idx))
}

#[tauri::command(async)]
fn category_page(state: State<'_, AppState>, project: String, name: String, include_sub: bool) -> AppResult<categories::CategoryPage> {
    state.with_index(&project, true, |_, idx| categories::page(idx, &name, include_sub))
}

#[tauri::command(async)]
fn set_page_categories(state: State<'_, AppState>, project: String, id: String, categories: Vec<String>) -> AppResult<Vec<String>> {
    state.with_index(&project, false, |library, idx| categories::set_page_categories(library, &project, idx, &id, &categories))
}

#[tauri::command(async)]
fn set_page_sort(state: State<'_, AppState>, project: String, id: String, sort: Option<String>) -> AppResult<()> {
    state.with_index(&project, false, |library, idx| categories::set_page_sort(library, &project, idx, &id, sort.as_deref()))
}

#[tauri::command(async)]
fn create_category(state: State<'_, AppState>, project: String, name: String) -> AppResult<String> {
    state.with_index(&project, true, |_, idx| categories::create(idx, &name))
}

#[tauri::command(async)]
fn save_category_text(state: State<'_, AppState>, project: String, name: String, text: String) -> AppResult<()> {
    state.with_index(&project, false, |_, idx| categories::save_text(idx, &name, &text))
}

#[tauri::command(async)]
fn set_category_parents(state: State<'_, AppState>, project: String, name: String, parents: Vec<String>) -> AppResult<Vec<String>> {
    state.with_index(&project, true, |_, idx| categories::set_parents(idx, &name, &parents))
}

/// Renames (`new_name`) or deletes (none) a category; `dry_run` only counts.
#[tauri::command(async)]
fn change_category(
    state: State<'_, AppState>,
    project: String,
    name: String,
    new_name: Option<String>,
    dry_run: bool,
) -> AppResult<categories::CategoryChange> {
    state.with_index(&project, true, |library, idx| {
        categories::rename_or_delete(library, &project, idx, &name, new_name.as_deref(), dry_run)
    })
}

#[tauri::command(async)]
fn category_backlinks(state: State<'_, AppState>, project: String, name: String, context: bool) -> AppResult<Vec<Backlink>> {
    state.with_index(&project, false, |library, idx| categories::backlinks(library, &project, idx, &name, context))
}

#[tauri::command(async)]
fn category_preview(state: State<'_, AppState>, project: String, name: String) -> AppResult<categories::CategoryPreview> {
    state.with_index(&project, false, |_, idx| categories::preview(idx, &name))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Images in a project's assets/ folder: wikiasset://localhost/<project>%2F<file>
        // (http://wikiasset.localhost/… on Windows). "?w=640" asks for a copy
        // about that wide (made once, kept in .cache/). Answered off the main
        // thread, since shrinking a big image takes a moment.
        .register_asynchronous_uri_scheme_protocol("wikiasset", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                let state = app.state::<AppState>();
                let found = state.library().and_then(|lib| assets::resolve_url_path(&lib, request.uri().path()));
                let width = assets::query_width(request.uri().query());
                let file = found.map(|(dir, path)| match width {
                    Some(w) => assets::display_file(&dir, &path, w),
                    None => path,
                });
                let response = match file.and_then(|path| Ok((std::fs::read(&path)?, path))) {
                    Ok((data, path)) => tauri::http::Response::builder()
                        .header("Content-Type", assets::mime_type(&path.to_string_lossy()))
                        .header("Cache-Control", "no-cache")
                        // SVGs are pictures only: nothing inside them runs.
                        .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:")
                        .body(data),
                    Err(_) => tauri::http::Response::builder().status(404).body(Vec::new()),
                };
                responder.respond(response.unwrap_or_else(|_| tauri::http::Response::new(Vec::new())));
            });
        })
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let settings = settings::load(&config_dir);
            app.manage(AppState {
                config_dir,
                settings: Mutex::new(settings),
                index: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_library_path,
            list_projects,
            create_project,
            rename_project,
            delete_project,
            get_tree,
            create_page,
            read_page,
            save_page,
            rename_page,
            move_page,
            delete_page,
            create_group,
            rename_group,
            move_group,
            delete_group,
            set_aliases,
            set_main_page,
            page_sections,
            link_preview,
            backlinks,
            link_count,
            embedded_in,
            embed_sources,
            save_infobox,
            get_templates,
            set_templates,
            template_pages,
            apply_template,
            incoming_fields,
            import_image,
            import_image_data,
            get_image_frame,
            get_project_settings,
            set_project_settings,
            set_image_frame,
            list_categories,
            category_page,
            set_page_categories,
            set_page_sort,
            create_category,
            save_category_text,
            set_category_parents,
            change_category,
            category_backlinks,
            category_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
