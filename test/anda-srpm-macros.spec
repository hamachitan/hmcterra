Name:           anda-srpm-macros
Version:        0.2.29
Release:        1%?dist
Summary:        SRPM macros for extra Fedora packages

License:        MIT
URL:            https://github.com/terrapkg/srpm-macros
Source0:        %url/archive/refs/tags/v%{version}.tar.gz
Packager:       some packager <some_packager@example.com>

Recommends:     rust-packaging
Requires:       git-core
Requires:       terra-appstream-helper
Obsoletes:      fyra-srpm-macros < 0.1.1-1
Provides:       fyra-srpm-macros = %{version}-%{release}
BuildArch:      noarch

%description
%{summary}.

%prep
%autosetup -n srpm-macros-%version

%build

%install
for file in ./macros.*; do
    install -Dpm644 -t %buildroot%_rpmmacrodir $file
done
install -Dpm755 *.sh -t %buildroot%_libexecdir/%name/

%files
%attr(0755, root, root) %_libexecdir/%name/*.sh
%{_rpmmacrodir}/macros.anda
%{_rpmmacrodir}/macros.caching
%{_rpmmacrodir}/macros.cargo_extra
%{_rpmmacrodir}/macros.electron
%{_rpmmacrodir}/macros.go_extra
%{_rpmmacrodir}/macros.nim_extra
%{_rpmmacrodir}/macros.nodejs_extra
%{_rpmmacrodir}/macros.zig_extra


%changelog
%autochangelog
