from django.urls import path
from .views import (
    DatabasesView, ProjectsView, ProjectTypesView, ProjectConfigView, ProgressView,
    TablesView, ColumnsView, ColumnRangeView,
    SaveTemplateView, ListTemplatesView, GetTemplateView,
    ExportDataView, UploadDriveTestView, DriveTestColumnsView, DriveTestColumnRangeView,
    GenerateGridView, UploadGridMapView, GridMapColumnRangeView, GridMapFromTableView,
    QueryDataView, BandsView, DistinctValuesView,AvailableDatesView,
)

urlpatterns = [
    # Core
    path('databases/', DatabasesView.as_view()),
    path('projects/', ProjectsView.as_view()),
    path('projects/<str:project>/types/', ProjectTypesView.as_view()),
    path('projects/<str:project>/config/', ProjectConfigView.as_view()),
    path('progress/', ProgressView.as_view()),
    path('available-dates/', AvailableDatesView.as_view()),

    # Metadata
    path('tables/', TablesView.as_view()),
    path('columns/<str:table>/', ColumnsView.as_view()),
    path('column-range/', ColumnRangeView.as_view()),

    # Query / bands / filters
    path('query/', QueryDataView.as_view()),
    path('bands/<str:table>/', BandsView.as_view()),
    
    path('distinct-values/<str:table>', DistinctValuesView.as_view()),
    path('distinct-values/<str:table>/', DistinctValuesView.as_view()),
]


