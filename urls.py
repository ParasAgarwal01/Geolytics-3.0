from django.urls import path
from .views import (
    DatabasesView, ProjectsView, ProjectTypesView, ProjectConfigView, ProgressView,
    TablesView, ColumnsView, ColumnRangeView,
    SaveTemplateView, ListTemplatesView, GetTemplateView,
    ExportDataView, UploadDriveTestView, DriveTestColumnsView, DriveTestColumnRangeView,
    GenerateGridView, UploadGridMapView, GridMapColumnRangeView, GridMapFromTableView,
    QueryDataView, BandsView, DistinctValuesView, GeoAPIRouterView,AvailableDatesView
)

urlpatterns = [
    # Core system
    path('databases', DatabasesView.as_view()),
    path('projects', ProjectsView.as_view()),
    path('projects/<str:project>/types', ProjectTypesView.as_view()),
    path('projects/<str:project>/config', ProjectConfigView.as_view()),
    path('progress', ProgressView.as_view()),
    path('available-dates', AvailableDatesView.as_view()),


    # Metadata
    path('tables', TablesView.as_view()),
    path('columns/<str:table>', ColumnsView.as_view()),
    path('column-range', ColumnRangeView.as_view()),

    # Templates
    path('save-template', SaveTemplateView.as_view()),
    path('templates', ListTemplatesView.as_view()),
    path('template/<str:name>', GetTemplateView.as_view()),

    # Export
    path('export', ExportDataView.as_view()),

    # Drive Test
    path('upload-drive-test', UploadDriveTestView.as_view()),
    path('drive-test/columns', DriveTestColumnsView.as_view()),
    path('drive-test/column-range', DriveTestColumnRangeView.as_view()),

    # Grid / KPI
    path('generate-grid', GenerateGridView.as_view()),
    path('geo-api/upload-grid-map', UploadGridMapView.as_view()),
    path('grid-map/column-range', GridMapColumnRangeView.as_view()),
    path('grid-map/from-table', GridMapFromTableView.as_view()),

    # Query / Bands / Distinct
    path('query', QueryDataView.as_view()),
    path('bands/<str:table>', BandsView.as_view()),
    path('distinct-values/<str:table>', DistinctValuesView.as_view()),

    # Geo-API aliases
    path('geo-api/query', QueryDataView.as_view()),
    path('geo-api/databases', DatabasesView.as_view()),
    path('geo-api/projects', ProjectsView.as_view()),
    path('geo-api/projects/<str:project>/types', ProjectTypesView.as_view()),
    path('geo-api/projects/<str:project>/config', ProjectConfigView.as_view()),
    path('geo-api/bands/<str:table>', BandsView.as_view()),
    path('geo-api/distinct-values/<str:table>', DistinctValuesView.as_view()),
    path('geo-api/columns/<str:project_name>', ColumnsView.as_view()),
    path('geo-api/available-dates', AvailableDatesView.as_view()),

]
