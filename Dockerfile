FROM registry.fedoraproject.org/fedora-minimal:43
WORKDIR /usr/src/app
COPY terra.repo /etc/yum.repos.d/
RUN dnf in -y --repo=terra,fedora --setopt=max_parallel_downloads=20 --setopt=install_weak_deps=0 deno rpmspec
COPY . .
RUN deno ci --omit=dev && \
    deno clean
ENV NODE_ENV="production"
CMD [ "deno", "start" ]
