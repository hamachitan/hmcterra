FROM registry.fedoraproject.org/fedora-minimal:43
WORKDIR /usr/src/app
COPY terra.repo /etc/yum.repos.d/
RUN dnf in -y --repo=terra,fedora --setopt=max_parallel_downloads=20 --setopt=install_weak_deps=0 bun rpmspec
COPY . .
RUN bun ci --omit=dev && \
    bun i typescript && bun run build && bun uninstall typescript && \
    bun pm cache rm
ENV NODE_ENV="production"
CMD [ "bun", "start" ]
